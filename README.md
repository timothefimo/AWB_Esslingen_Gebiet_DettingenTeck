# ioBroker.awb-esslingen

![Logo](admin/awb-es.png)

**Müllkalender-Adapter für den Abfallwirtschaftsbetrieb des Landkreises Esslingen (AWB-ES)**

Dieser Adapter ruft automatisch die Abfuhrtermine für alle Müllsorten direkt von [awb-es.de](https://www.awb-es.de) ab und stellt sie als Datenpunkte in ioBroker zur Verfügung. Unterstützt werden alle Gemeinden im Landkreis Esslingen (z.B. Dettingen unter Teck, Kirchheim, Esslingen, Plochingen, …).

---

## Installation (von GitHub)

### Über den ioBroker Admin

1. Im ioBroker Admin → **Adapter** → oben rechts auf das **GitHub-Symbol** (Katze) klicken
2. Tab **„Von einer URL"** wählen
3. Diese URL eingeben:
   ```
   https://github.com/timothefimo/ioBroker.awb-esslingen
   ```
4. **Installieren** klicken

### Per Kommandozeile

```bash
cd /opt/iobroker
iobroker url https://github.com/timothefimo/ioBroker.awb-esslingen
```

---

## Konfiguration

Nach der Installation eine neue **Instanz** anlegen und im Konfigurationsdialog ausfüllen.

### Tab „Einstellungen"

| Feld | Beschreibung | Beispiel |
|------|-------------|---------|
| **Ort** | Gemeindename exakt wie im AWB-Dropdown | `Dettingen unter Teck` |
| **Straße** | Straßenname exakt wie im AWB-Dropdown | `Am Kelterplatz` |
| **Aktualisierungsintervall** | Stunden zwischen automatischen Abrufen | `6` |

> 💡 **Tipp:** Den genauen Ort- und Straßennamen auf [awb-es.de/abfuhr/abfuhrtermine](https://www.awb-es.de/abfuhr/abfuhrtermine/__Abfuhrtermine.html) nachschlagen. Ort eingeben → aus Dropdown auswählen → Straße eingeben → aus Dropdown auswählen. Den Text **exakt so** in den Adapter übernehmen.

### Tab „Abfalltypen"

Die vier Standard-Müllsorten sind vorkonfiguriert mit den **exakten Bezeichnungen aus dem AWB-ICS-Kalender**:

| Name | ID | Schlüsselwörter (exakt aus ICS) |
|------|----|---------------------------------|
| Restmüll | `restmuell` | `Restmüll,Restabfall` |
| Biomüll | `biomuell` | `Biotonne,Biomüll` |
| Papier | `papier` | `Papiertonne,Papier` |
| Gelber Sack | `gelberSack` | `Gelbe/r Sack/Tonne,Gelber Sack` |

> ⚠️ **Wichtig:** Der Gelbe Sack heißt im AWB-Kalender `Gelbe/r Sack/Tonne` – genau so mit Schrägstrichen. Das ist korrekt voreingestellt und darf nicht geändert werden.

### Konfiguration per Kommandozeile setzen

Falls die Admin-UI nicht öffnet, können Ort und Straße direkt gesetzt werden:

```bash
iobroker object set system.adapter.awb-esslingen.0 native.city="Dettingen unter Teck"
iobroker object set system.adapter.awb-esslingen.0 native.street="Am Kelterplatz"
iobroker restart awb-esslingen.0
```

Falls die Keywords zurückgesetzt werden müssen:

```bash
iobroker object set system.adapter.awb-esslingen.0 native.wasteTypes='[{"name":"Restmüll","id":"restmuell","keywords":"Restmüll,Restabfall","color":"#808080"},{"name":"Biomüll","id":"biomuell","keywords":"Biotonne,Biomüll","color":"#8B4513"},{"name":"Papier","id":"papier","keywords":"Papiertonne,Papier","color":"#0000FF"},{"name":"Gelber Sack","id":"gelberSack","keywords":"Gelbe/r Sack/Tonne,Gelber Sack","color":"#FFD700"}]'
iobroker restart awb-esslingen.0
```

---

## Datenpunkte

Der Adapter erstellt folgende Datenpunkte (Beispiel für Restmüll, analog für `biomuell`, `papier`, `gelberSack`):

| Datenpunkt | Typ | Beschreibung | Beispiel |
|-----------|-----|-------------|---------|
| `awb-esslingen.0.type.restmuell.naechsterTermin` | string | Nächster Termin (DE-Format) | `15.06.2026` |
| `awb-esslingen.0.type.restmuell.naechsterTerminTS` | number | Nächster Termin (Unix-Timestamp ms) | `1750982400000` |
| `awb-esslingen.0.type.restmuell.tageVerbleibend` | number | Tage bis zur Abholung (0 = heute) | `0` |
| `awb-esslingen.0.type.restmuell.abholungHeute` | boolean | Wird heute abgeholt? | `true` |
| `awb-esslingen.0.type.restmuell.abholungMorgen` | boolean | Wird morgen abgeholt? | `false` |
| `awb-esslingen.0.type.restmuell.aktuellerTermin` | string | Originaltext aus ICS | `Restmüll 2-wöchentlich` |
| `awb-esslingen.0.info.lastUpdate` | string | Zeitpunkt der letzten Aktualisierung | `30.05.2026 12:14:17` |
| `awb-esslingen.0.info.status` | string | Status des letzten Abrufs | `OK – 120 Termine geladen` |
| `awb-esslingen.0.info.connection` | boolean | Verbindung erfolgreich | `true` |

---

## Adapter aktualisieren

```bash
cd /opt/iobroker
iobroker url https://github.com/timothefimo/ioBroker.awb-esslingen
iobroker restart awb-esslingen.0
```

---

## Verwendung in Node-RED

Ein fertiger Node-RED Dashboard-Flow ist im Repository unter [`nodered/muellkalender_nodered.json`](nodered/muellkalender_nodered.json) verfügbar.

Import: Node-RED → ☰ Menü → Import → Datei auswählen → Deploy

---

## Verwendung in Blockly / JavaScript

```javascript
// Benachrichtigung wenn morgen Müll abgeholt wird
const types = ['restmuell', 'biomuell', 'papier', 'gelberSack'];
const namen = { restmuell: 'Restmüll', biomuell: 'Biomüll', papier: 'Papier', gelberSack: 'Gelber Sack' };

const morgen = types.filter(t =>
    getState(`awb-esslingen.0.type.${t}.abholungMorgen`).val
);

if (morgen.length > 0) {
    const msg = 'Morgen wird abgeholt: ' + morgen.map(t => namen[t]).join(', ');
    sendTo('pushover', msg);
}
```

---

## Fehlerbehebung

### „Keine ICS-URL gefunden"
Ort oder Straße stimmt nicht exakt mit dem AWB-Dropdown überein.
→ Auf [awb-es.de](https://www.awb-es.de/abfuhr/abfuhrtermine/__Abfuhrtermine.html) den genauen Text aus dem Dropdown kopieren.

### „Gelber Sack: Kein Termin"
Die Keywords passen nicht. Im AWB-Kalender heißt der Gelbe Sack `Gelbe/r Sack/Tonne`.
→ Keywords per Kommandozeile zurücksetzen (siehe oben).

### Adapter startet nicht (INVALID_ADAPTER_CONFIG)
Ort oder Straße ist leer.
→ Per Kommandozeile setzen (siehe oben).

### Heutiger Termin wird nicht angezeigt
War ein Zeitzonenproblem (UTC vs. Europe/Berlin) – ab Version 0.1.1 behoben.
→ Adapter auf aktuelle Version aktualisieren.

---

## Changelog

### 0.1.1 (2026-05-30)
- Zeitzonenproblem behoben: heutige Termine wurden auf Systemen mit Zeitzone Europe/Berlin fälschlich als vergangen gefiltert
- Schlüsselwörter an exakte AWB Esslingen ICS-Bezeichnungen angepasst (`Gelbe/r Sack/Tonne`, `Biotonne`, `Papiertonne`)
- `info.connection` Datenpunkt hinzugefügt

### 0.1.0 (2026-05-30)
- Erstveröffentlichung
- Unterstützung aller Gemeinden im Landkreis Esslingen
- Konfigurierbare Abfalltypen mit Schlüsselwort-Matching
- Admin-UI mit JSON-Konfiguration

---

## Lizenz

MIT License – siehe [LICENSE](LICENSE)
