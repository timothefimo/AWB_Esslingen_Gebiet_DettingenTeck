'use strict';

const utils  = require('@iobroker/adapter-core');
const axios  = require('axios');
const { parse } = require('node-html-parser');

// ─── Typen-Farb-Map für Icon-Farben ────────────────────────────────────────
const DEFAULT_COLORS = {
    restmuell:  '#808080',
    biomuell:   '#8B4513',
    papier:     '#0000FF',
    gelberSack: '#FFD700',
};

class AwbEs extends utils.Adapter {

    constructor(options) {
        super({ ...options, name: 'awb-es' });

        this._updateTimeout  = null;
        this._updateInterval = null;

        this.on('ready',       this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('unload',      this.onUnload.bind(this));
    }

    // ── Adapter bereit ────────────────────────────────────────────────────
    async onReady() {
        this.log.info('AWB-ES Adapter gestartet');
        await this.setStateAsync('info.connection', { val: false, ack: true });

        // Konfiguration prüfen
        const city   = (this.config.city   || '').trim();
        const street = (this.config.street || '').trim();

        if (!city || !street) {
            this.log.error('Bitte Ort und Straße in der Adapter-Konfiguration eingeben!');
            await this.setStateAsync('info.connection', { val: false, ack: true });
            return;
        }

        // Datenpunkte anlegen
        await this.createObjects();

        // Sofort beim Start abrufen
        await this.updateWasteData();

        // Regelmäßig aktualisieren (Standard: alle 6 Stunden)
        const intervalHours = Math.max(1, this.config.updateInterval || 6);
        this._updateInterval = setInterval(
            () => this.updateWasteData(),
            intervalHours * 60 * 60 * 1000
        );
    }

    // ── Datenpunkte anlegen ───────────────────────────────────────────────
    async createObjects() {
        const wasteTypes = this.config.wasteTypes || [];

        for (const wt of wasteTypes) {
            const id = wt.id;

            // Kanal anlegen
            await this.setObjectNotExistsAsync(`type.${id}`, {
                type:   'channel',
                common: { name: wt.name },
                native: {},
            });

            // Datenpunkte
            await this.setObjectNotExistsAsync(`type.${id}.naechsterTermin`, {
                type:   'state',
                common: {
                    name:  `${wt.name} – Nächster Termin`,
                    type:  'string',
                    role:  'date',
                    read:  true,
                    write: false,
                    def:   '',
                },
                native: {},
            });

            await this.setObjectNotExistsAsync(`type.${id}.naechsterTerminTS`, {
                type:   'state',
                common: {
                    name:  `${wt.name} – Nächster Termin (Timestamp)`,
                    type:  'number',
                    role:  'date',
                    read:  true,
                    write: false,
                    def:   0,
                },
                native: {},
            });

            await this.setObjectNotExistsAsync(`type.${id}.tageVerbleibend`, {
                type:   'state',
                common: {
                    name:  `${wt.name} – Tage verbleibend`,
                    type:  'number',
                    role:  'value',
                    unit:  'Tage',
                    read:  true,
                    write: false,
                    def:   -1,
                },
                native: {},
            });

            await this.setObjectNotExistsAsync(`type.${id}.abholungHeute`, {
                type:   'state',
                common: {
                    name:  `${wt.name} – Abholung heute`,
                    type:  'boolean',
                    role:  'indicator',
                    read:  true,
                    write: false,
                    def:   false,
                },
                native: {},
            });

            await this.setObjectNotExistsAsync(`type.${id}.abholungMorgen`, {
                type:   'state',
                common: {
                    name:  `${wt.name} – Abholung morgen`,
                    type:  'boolean',
                    role:  'indicator',
                    read:  true,
                    write: false,
                    def:   false,
                },
                native: {},
            });

            await this.setObjectNotExistsAsync(`type.${id}.aktuellerTermin`, {
                type:   'state',
                common: {
                    name:  `${wt.name} – Aktueller Termin (aus ICS)`,
                    type:  'string',
                    role:  'text',
                    read:  true,
                    write: false,
                    def:   '',
                },
                native: {},
            });
        }

        // Allgemeine Datenpunkte
        await this.setObjectNotExistsAsync('info.lastUpdate', {
            type:   'state',
            common: {
                name:  'Letzte Aktualisierung',
                type:  'string',
                role:  'text',
                read:  true,
                write: false,
                def:   '',
            },
            native: {},
        });

        await this.setObjectNotExistsAsync('info.status', {
            type:   'state',
            common: {
                name:  'Status',
                type:  'string',
                role:  'text',
                read:  true,
                write: false,
                def:   '',
            },
            native: {},
        });
    }

    // ── Hauptabruf ────────────────────────────────────────────────────────
    async updateWasteData() {
        const city   = (this.config.city   || '').trim();
        const street = (this.config.street || '').trim();

        this.log.info(`Rufe Abfuhrtermine ab für: ${city} / ${street}`);
        await this.setStateAsync('info.status', { val: 'Lade Daten...', ack: true });

        try {
            // Schritt 1: HTML-Seite laden und ICS-URL extrahieren
            const icsUrl = await this.fetchIcsUrl(city, street);
            this.log.debug(`ICS-URL gefunden: ${icsUrl}`);

            // Schritt 2: ICS-Datei laden
            const icsText = await this.fetchIcs(icsUrl);
            this.log.debug(`ICS geladen, Länge: ${icsText.length} Zeichen`);

            // Schritt 3: ICS parsen
            const events = this.parseIcs(icsText);
            this.log.info(`${events.length} Termine aus ICS geparst`);

            if (events.length === 0) {
                throw new Error('ICS-Datei enthält keine Termine – bitte Straßenname prüfen');
            }

            // Schritt 4: Datenpunkte aktualisieren
            await this.writeStates(events);

            // Status setzen
            const now = new Date();
            const ts  = now.toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });
            await this.setStateAsync('info.lastUpdate',    { val: ts,                              ack: true });
            await this.setStateAsync('info.status',        { val: `OK – ${events.length} Termine`, ack: true });
            await this.setStateAsync('info.connection',    { val: true,                            ack: true });

            this.log.info('Aktualisierung erfolgreich abgeschlossen');

        } catch (err) {
            const msg = `Fehler: ${err.message}`;
            this.log.error(msg);
            await this.setStateAsync('info.status',     { val: msg,  ack: true });
            await this.setStateAsync('info.connection', { val: false, ack: true });
        }
    }

    // ── Schritt 1: HTML-Seite abrufen und ICS-URL extrahieren ─────────────
    async fetchIcsUrl(city, street) {
        const url = 'https://www.awb-es.de/abfuhr/abfuhrtermine/__Abfuhrtermine.html';

        const response = await axios.get(url, {
            params: {
                city:   city,
                street: street,
                direct: 'true',
            },
            headers: {
                'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124',
                'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'de-DE,de;q=0.9',
            },
            timeout: 30000,
            maxRedirects: 5,
        });

        const html  = response.data;
        const root  = parse(html);
        const links = root.querySelectorAll('a[href]');

        let icsUrl = null;
        for (const link of links) {
            const href = link.getAttribute('href') || '';
            if (href.includes('t=ics') || href.toLowerCase().endsWith('.ics')) {
                icsUrl = href;
                break;
            }
        }

        if (!icsUrl) {
            // Fallback: Regex-Suche
            const match = html.match(/href="([^"]*(?:t=ics|\.ics)[^"]*)"/i);
            if (match) {
                icsUrl = match[1];
            }
        }

        if (!icsUrl) {
            throw new Error(
                `Keine ICS-URL gefunden. Bitte prüfe Ort "${city}" und Straße "${street}" ` +
                `auf https://www.awb-es.de/abfuhr/abfuhrtermine/__Abfuhrtermine.html`
            );
        }

        // Relative URL in absolute umwandeln
        if (!icsUrl.startsWith('http')) {
            icsUrl = 'https://www.awb-es.de' + (icsUrl.startsWith('/') ? '' : '/') + icsUrl;
        }

        return icsUrl;
    }

    // ── Schritt 2: ICS-Datei herunterladen ───────────────────────────────
    async fetchIcs(icsUrl) {
        const response = await axios.get(icsUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124',
            },
            timeout: 30000,
            responseType: 'text',
        });
        return response.data;
    }

    // ── Schritt 3: ICS parsen ─────────────────────────────────────────────
    parseIcs(icsText) {
        const events = [];
        // Zeilenenden normalisieren
        const lines  = icsText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

        let inEvent = false;
        let current = {};

        for (const line of lines) {
            const trimmed = line.trim();

            if (trimmed === 'BEGIN:VEVENT') {
                inEvent = true;
                current = {};
                continue;
            }

            if (trimmed === 'END:VEVENT') {
                inEvent = false;
                if (current.summary && current.date) {
                    events.push({
                        summary: current.summary,
                        date:    current.date,
                        ts:      new Date(current.date).getTime(),
                    });
                }
                continue;
            }

            if (!inEvent) continue;

            if (trimmed.startsWith('SUMMARY:')) {
                current.summary = trimmed.substring(8).trim();
            } else if (trimmed.startsWith('DTSTART')) {
                // DTSTART;VALUE=DATE:20260601 oder DTSTART:20260601T000000Z
                const rawVal  = trimmed.split(':').slice(1).join(':').trim();
                const dateStr = rawVal.substring(0, 8); // YYYYMMDD
                if (dateStr.length === 8 && /^\d{8}$/.test(dateStr)) {
                    current.date = `${dateStr.substring(0,4)}-${dateStr.substring(4,6)}-${dateStr.substring(6,8)}`;
                }
            }
        }

        // Sortieren nach Datum
        events.sort((a, b) => a.ts - b.ts);
        return events;
    }

    // ── Schritt 4: Datenpunkte schreiben ─────────────────────────────────
    async writeStates(events) {
        const heute   = new Date();
        heute.setHours(0, 0, 0, 0);
        const heuteTs = heute.getTime();

        // Nur zukünftige und heutige Termine
        const upcoming = events.filter(e => e.ts >= heuteTs);

        const wasteTypes = this.config.wasteTypes || [];

        for (const wt of wasteTypes) {
            const id       = wt.id;
            const keywords = (wt.keywords || '').split(',').map(k => k.trim().toLowerCase()).filter(Boolean);

            // Ersten passenden Termin finden
            const match = upcoming.find(e =>
                keywords.some(kw => e.summary.toLowerCase().includes(kw))
            );

            if (match) {
                const matchDate = new Date(match.date);
                matchDate.setHours(0, 0, 0, 0);
                const tage = Math.round((matchDate.getTime() - heuteTs) / (1000 * 60 * 60 * 24));

                const formatted = matchDate.toLocaleDateString('de-DE', {
                    day:   '2-digit',
                    month: '2-digit',
                    year:  'numeric',
                });

                await this.setStateAsync(`type.${id}.naechsterTermin`,   { val: formatted,       ack: true });
                await this.setStateAsync(`type.${id}.naechsterTerminTS`, { val: matchDate.getTime(), ack: true });
                await this.setStateAsync(`type.${id}.tageVerbleibend`,   { val: tage,            ack: true });
                await this.setStateAsync(`type.${id}.abholungHeute`,     { val: tage === 0,      ack: true });
                await this.setStateAsync(`type.${id}.abholungMorgen`,    { val: tage === 1,      ack: true });
                await this.setStateAsync(`type.${id}.aktuellerTermin`,   { val: match.summary,   ack: true });

                this.log.info(`${wt.name}: ${formatted} (in ${tage} Tag(en)) – "${match.summary}"`);
            } else {
                await this.setStateAsync(`type.${id}.naechsterTermin`,   { val: 'Kein Termin',   ack: true });
                await this.setStateAsync(`type.${id}.naechsterTerminTS`, { val: 0,               ack: true });
                await this.setStateAsync(`type.${id}.tageVerbleibend`,   { val: -1,              ack: true });
                await this.setStateAsync(`type.${id}.abholungHeute`,     { val: false,           ack: true });
                await this.setStateAsync(`type.${id}.abholungMorgen`,    { val: false,           ack: true });
                await this.setStateAsync(`type.${id}.aktuellerTermin`,   { val: '',              ack: true });

                this.log.warn(`${wt.name}: Kein Termin gefunden (Schlüsselwörter: ${keywords.join(', ')})`);
            }
        }
    }

    // ── State-Änderungen ─────────────────────────────────────────────────
    onStateChange(id, state) {
        if (state && !state.ack) {
            this.log.debug(`State ${id} geändert: ${JSON.stringify(state)}`);
        }
    }

    // ── Adapter beenden ───────────────────────────────────────────────────
    async onUnload(callback) {
        try {
            if (this._updateInterval) {
                clearInterval(this._updateInterval);
                this._updateInterval = null;
            }
            if (this._updateTimeout) {
                clearTimeout(this._updateTimeout);
                this._updateTimeout = null;
            }
            this.log.info('AWB-ES Adapter beendet');
        } catch (e) {
            this.log.error(e);
        } finally {
            callback();
        }
    }
}

// ── Start ────────────────────────────────────────────────────────────────────
if (require.main !== module) {
    module.exports = (options) => new AwbEs(options);
} else {
    new AwbEs();
}
