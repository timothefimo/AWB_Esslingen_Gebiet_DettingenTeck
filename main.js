'use strict';

const utils  = require('@iobroker/adapter-core');
const axios  = require('axios');
const { parse } = require('node-html-parser');

class AwbEs extends utils.Adapter {

    constructor(options) {
        super({ ...options, name: 'awb-esslingen' });
        this._updateInterval = null;
        this.on('ready',       this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('unload',      this.onUnload.bind(this));
    }

    async onReady() {
        this.log.info('AWB-ES Adapter gestartet');
        await this.setStateAsync('info.connection', { val: false, ack: true });

        await this.createObjects();

        const city   = (this.config.city   || '').trim();
        const street = (this.config.street || '').trim();

        if (!city || !street) {
            this.log.warn('Bitte Ort und Straße in der Adapter-Konfiguration eingeben!');
            await this.setStateAsync('info.status', { val: 'Bitte Ort und Straße konfigurieren!', ack: true });
            return;
        }

        await this.updateWasteData();

        const intervalHours = Math.max(1, this.config.updateInterval || 6);
        this._updateInterval = setInterval(
            () => this.updateWasteData(),
            intervalHours * 60 * 60 * 1000
        );
    }

    // ── Datum LOKAL parsen (Fix für Zeitzonenproblem UTC vs. Europe/Berlin) ──
    // new Date('2026-05-30') = UTC-Mitternacht = 02:00 MESZ auf dem Pi
    // → heutiger Termin wird fälschlich als "gestern" gefiltert!
    parseDateLocal(dateStr) {
        const [y, m, d] = dateStr.split('-').map(Number);
        return new Date(y, m - 1, d, 0, 0, 0, 0); // Lokale Mitternacht
    }

    async createObjects() {
        const wasteTypes = this.getWasteTypes();

        for (const wt of wasteTypes) {
            await this.setObjectNotExistsAsync(`type.${wt.id}`, {
                type: 'channel', common: { name: wt.name }, native: {}
            });
            const states = [
                { id: 'naechsterTermin',   type: 'string',  role: 'text',      def: '',    name: `${wt.name} – Nächster Termin` },
                { id: 'naechsterTerminTS', type: 'number',  role: 'date',      def: 0,     name: `${wt.name} – Nächster Termin Timestamp` },
                { id: 'tageVerbleibend',   type: 'number',  role: 'value',     def: -1,    name: `${wt.name} – Tage verbleibend`, unit: 'Tage' },
                { id: 'abholungHeute',     type: 'boolean', role: 'indicator', def: false, name: `${wt.name} – Abholung heute` },
                { id: 'abholungMorgen',    type: 'boolean', role: 'indicator', def: false, name: `${wt.name} – Abholung morgen` },
                { id: 'aktuellerTermin',   type: 'string',  role: 'text',      def: '',    name: `${wt.name} – Originaltext ICS` },
            ];
            for (const s of states) {
                await this.setObjectNotExistsAsync(`type.${wt.id}.${s.id}`, {
                    type: 'state',
                    common: { name: s.name, type: s.type, role: s.role, unit: s.unit || '', read: true, write: false, def: s.def },
                    native: {}
                });
            }
        }

        await this.setObjectNotExistsAsync('info.lastUpdate', {
            type: 'state', common: { name: 'Letzte Aktualisierung', type: 'string', role: 'text', read: true, write: false, def: '' }, native: {}
        });
        await this.setObjectNotExistsAsync('info.status', {
            type: 'state', common: { name: 'Status', type: 'string', role: 'text', read: true, write: false, def: '' }, native: {}
        });
    }

    getWasteTypes() {
        return this.config.wasteTypes && this.config.wasteTypes.length > 0
            ? this.config.wasteTypes
            : [
                { name: 'Restmüll',    id: 'restmuell',  keywords: 'Restmüll,Restabfall' },
                { name: 'Biomüll',     id: 'biomuell',   keywords: 'Biotonne,Biomüll' },
                { name: 'Papier',      id: 'papier',     keywords: 'Papiertonne,Papier' },
                { name: 'Gelber Sack', id: 'gelberSack', keywords: 'Gelbe/r Sack/Tonne,Gelber Sack,Gelbe Tonne' },
            ];
    }

    async updateWasteData() {
        const city   = (this.config.city   || '').trim();
        const street = (this.config.street || '').trim();
        if (!city || !street) return;

        this.log.info(`Rufe Abfuhrtermine ab für: ${city} / ${street}`);
        await this.setStateAsync('info.status', { val: 'Lade Daten...', ack: true });

        try {
            const icsUrl  = await this.fetchIcsUrl(city, street);
            const icsText = await this.fetchIcs(icsUrl);
            const events  = this.parseIcs(icsText);

            this.log.info(`${events.length} Termine geladen`);
            if (events.length === 0) throw new Error('Keine Termine in ICS gefunden');

            await this.writeStates(events);

            const now = new Date();
            const ts  = now.toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });
            await this.setStateAsync('info.lastUpdate', { val: ts,                            ack: true });
            await this.setStateAsync('info.status',     { val: `OK – ${events.length} Termine`, ack: true });
            await this.setStateAsync('info.connection', { val: true,                          ack: true });

        } catch (err) {
            this.log.error(`Fehler: ${err.message}`);
            await this.setStateAsync('info.status',     { val: `Fehler: ${err.message}`, ack: true });
            await this.setStateAsync('info.connection', { val: false,                    ack: true });
        }
    }

    async fetchIcsUrl(city, street) {
        const response = await axios.get(
            'https://www.awb-es.de/abfuhr/abfuhrtermine/__Abfuhrtermine.html',
            {
                params:  { city, street, direct: 'true' },
                headers: {
                    'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124',
                    'Accept':          'text/html,application/xhtml+xml',
                    'Accept-Language': 'de-DE,de;q=0.9',
                },
                timeout: 30000,
                maxRedirects: 5,
            }
        );

        const root  = parse(response.data);
        let icsUrl  = null;

        for (const link of root.querySelectorAll('a[href]')) {
            const href = link.getAttribute('href') || '';
            if (href.includes('t=ics') || href.toLowerCase().endsWith('.ics')) {
                icsUrl = href;
                break;
            }
        }

        if (!icsUrl) {
            const match = response.data.match(/href="([^"]*(?:t=ics|\.ics)[^"]*)"/i);
            if (match) icsUrl = match[1];
        }

        if (!icsUrl) {
            throw new Error(
                `Keine ICS-URL gefunden. Bitte Ort "${city}" und Straße "${street}" ` +
                `exakt wie im Dropdown auf awb-es.de eingeben.`
            );
        }

        if (!icsUrl.startsWith('http')) {
            icsUrl = 'https://www.awb-es.de' + (icsUrl.startsWith('/') ? '' : '/') + icsUrl;
        }
        return icsUrl;
    }

    async fetchIcs(icsUrl) {
        const response = await axios.get(icsUrl, {
            headers:      { 'User-Agent': 'Mozilla/5.0 Chrome/124' },
            timeout:      30000,
            responseType: 'text',
        });
        return response.data;
    }

    parseIcs(icsText) {
        const events = [];
        const lines  = icsText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
        let inEvent  = false;
        let current  = {};

        for (const line of lines) {
            const t = line.trim();
            if (t === 'BEGIN:VEVENT') { inEvent = true; current = {}; continue; }
            if (t === 'END:VEVENT') {
                inEvent = false;
                if (current.summary && current.date) {
                    // WICHTIG: Datum lokal parsen (Zeitzonen-Fix)
                    const localDate = this.parseDateLocal(current.date);
                    events.push({
                        summary:  current.summary,
                        date:     current.date,
                        ts:       localDate.getTime(),
                        dateObj:  localDate,
                    });
                }
                continue;
            }
            if (!inEvent) continue;

            if (t.startsWith('SUMMARY:')) {
                current.summary = t.substring(8).trim();
            } else if (t.startsWith('DTSTART')) {
                const raw = t.split(':').slice(1).join(':').trim().substring(0, 8);
                if (/^\d{8}$/.test(raw)) {
                    current.date = `${raw.substring(0,4)}-${raw.substring(4,6)}-${raw.substring(6,8)}`;
                }
            }
        }

        return events.sort((a, b) => a.ts - b.ts);
    }

    async writeStates(events) {
        // Heute als lokale Mitternacht berechnen
        const heute = new Date();
        heute.setHours(0, 0, 0, 0);
        const heuteTs = heute.getTime();

        this.log.debug(`Heute (lokal): ${heute.toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}, ts=${heuteTs}`);

        // Nur heutige und zukünftige Termine
        const upcoming = events.filter(e => e.ts >= heuteTs);

        this.log.debug(`${upcoming.length} zukünftige Termine (von ${events.length} gesamt)`);
        if (upcoming.length > 0) {
            this.log.debug(`Erster: ${upcoming[0].date} – ${upcoming[0].summary}`);
        }

        const wasteTypes = this.getWasteTypes();

        for (const wt of wasteTypes) {
            const keywords = (wt.keywords || '')
                .split(',')
                .map(k => k.trim().toLowerCase())
                .filter(Boolean);

            const match = upcoming.find(e =>
                keywords.some(kw => e.summary.toLowerCase().includes(kw))
            );

            if (match) {
                // Tage berechnen (beide als lokale Mitternacht)
                const tage = Math.round((match.ts - heuteTs) / 86400000);

                const formatted = match.dateObj.toLocaleDateString('de-DE', {
                    day:   '2-digit',
                    month: '2-digit',
                    year:  'numeric',
                });

                await this.setStateAsync(`type.${wt.id}.naechsterTermin`,   { val: formatted,       ack: true });
                await this.setStateAsync(`type.${wt.id}.naechsterTerminTS`, { val: match.ts,        ack: true });
                await this.setStateAsync(`type.${wt.id}.tageVerbleibend`,   { val: tage,            ack: true });
                await this.setStateAsync(`type.${wt.id}.abholungHeute`,     { val: tage === 0,      ack: true });
                await this.setStateAsync(`type.${wt.id}.abholungMorgen`,    { val: tage === 1,      ack: true });
                await this.setStateAsync(`type.${wt.id}.aktuellerTermin`,   { val: match.summary,   ack: true });

                this.log.info(`${wt.name}: ${formatted} (in ${tage} Tag(en)) – "${match.summary}"`);
            } else {
                await this.setStateAsync(`type.${wt.id}.naechsterTermin`,   { val: 'Kein Termin', ack: true });
                await this.setStateAsync(`type.${wt.id}.naechsterTerminTS`, { val: 0,             ack: true });
                await this.setStateAsync(`type.${wt.id}.tageVerbleibend`,   { val: -1,            ack: true });
                await this.setStateAsync(`type.${wt.id}.abholungHeute`,     { val: false,         ack: true });
                await this.setStateAsync(`type.${wt.id}.abholungMorgen`,    { val: false,         ack: true });
                await this.setStateAsync(`type.${wt.id}.aktuellerTermin`,   { val: '',            ack: true });

                this.log.warn(`${wt.name}: Kein Termin – Schlüsselwörter: ${keywords.join(', ')}`);
            }
        }
    }

    onStateChange(id, state) {
        if (state && !state.ack) this.log.debug(`State ${id} geändert`);
    }

    async onUnload(callback) {
        try {
            if (this._updateInterval) clearInterval(this._updateInterval);
        } catch(e) {
            this.log.error(e);
        } finally {
            callback();
        }
    }
}

if (require.main !== module) {
    module.exports = (options) => new AwbEs(options);
} else {
    new AwbEs();
}
