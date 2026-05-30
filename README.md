# ioBroker.awb-es

![Logo](admin/awb-es.png)

**Müllkalender-Adapter für den Abfallwirtschaftsbetrieb des Landkreises Esslingen (AWB-ES)**

Dieser Adapter ruft automatisch die Abfuhrtermine für alle Müllsorten direkt von [awb-es.de](https://www.awb-es.de) ab und stellt sie als Datenpunkte in ioBroker zur Verfügung. Unterstützt werden alle Gemeinden im Landkreis Esslingen (z.B. Dettingen unter Teck, Kirchheim, Esslingen, Plochingen, …).

---

## Installation (von GitHub)

Da dieser Adapter noch nicht im offiziellen ioBroker-Repository ist, wird er über die **URL** installiert:

### Methode 1: Über den ioBroker Admin (empfohlen)

1. Im ioBroker Admin → **Adapter** → oben rechts auf das **GitHub-Symbol** (Katze) klicken  
   *(oder: Experten-Modus aktivieren → „Von URL installieren")*
2. Tab **„Von einer URL"** wählen
3. Diese URL eingeben:
   ```
   https://github.com/timothefimo/AWB_Esslingen_Gebiet_DettingenTeck
   ```
4. **Installieren** klicken

### Methode 2: Per Kommandozeile

```bash
cd /opt/iobroker
npm install iobroker.awb-es@https://github.com/timothefimo/AWB_Esslingen_Gebiet_DettingenTeck/archive/main.tar.gz
iobroker upload awb-es
```

---

## Konfiguration

1. Nach der Installation eine neue **Instanz** des Adapters anlegen
2. Im Konfigurationsdialog:

### Tab „Einstellungen"

| Feld | Beschreibung | Beispiel |
|------|-------------|---------|
| **Ort** | Gemeindename exakt wie auf awb-es.de | `Dettingen unter Teck` |
| **Straße** | Straßenname exakt wie auf awb-es.de | `Am Kelterplatz` |
| **Aktualisierungsintervall** | Stunden zwischen automatischen Abrufen | `6` |

> 💡 **Tipp:** Den genauen Straßennamen auf [awb-es.de/abfuhr/abfuhrtermine](https://www.awb-es.de/abfuhr/abfuhrtermine/__Abfuhrtermine.html) nachschlagen – Ort eingeben, dann im Dropdown die Straße auswählen und genau so in den Adapter übernehmen.

### Tab „Abfalltypen"

Hier sind die vier Standard-Müllsorten vorkonfiguriert. Die **Schlüsselwörter** werden im ICS-Kalender gesucht (Groß-/Kleinschreibung egal):

| Name | ID | Standard-Schlüsselwörter |
|------|----|--------------------------|
| Restmüll | `restmuell` | Restmüll, Restabfall, Graue Tonne |
| Biomüll | `biomuell` | Biomüll, Biotonne, Braune Tonne, Bio |
| Papier | `papier` | Papier, Papiertonne, Blaue Tonne |
| Gelber Sack | `gelberSack` | Gelber Sack, Gelbe Tonne, Leichtverpackung, LVP |

---

## Datenpunkte

Der Adapter erstellt folgende Datenpunkte (Beispiel für Restmüll, analog für andere Typen):

| Datenpunkt | Typ | Beschreibung | Beispiel |
|-----------|-----|-------------|---------|
| `awb-es.0.type.restmuell.naechsterTermin` | string | Nächster Termin (DE-Format) | `15.06.2026` |
| `awb-es.0.type.restmuell.naechsterTerminTS` | number | Nächster Termin (Unix-Timestamp ms) | `1750982400000` |
| `awb-es.0.type.restmuell.tageVerbleibend` | number | Tage bis zur Abholung | `16` |
| `awb-es.0.type.restmuell.abholungHeute` | boolean | Wird heute abgeholt? | `false` |
| `awb-es.0.type.restmuell.abholungMorgen` | boolean | Wird morgen abgeholt? | `false` |
| `awb-es.0.type.restmuell.aktuellerTermin` | string | Originaltext aus ICS | `Restmüll 2-wöchentlich` |
| `awb-es.0.info.lastUpdate` | string | Zeitpunkt der letzten Aktualisierung | `30.05.2026 06:00:15` |
| `awb-es.0.info.status` | string | Status des letzten Abrufs | `OK – 48 Termine geladen` |
| `awb-es.0.info.connection` | boolean | Verbindung erfolgreich | `true` |

---

## Verwendung in VIS / Blockly

### VIS Widget (einfache Anzeige)

In einem **Text**-Widget die Binding-Adresse:
```
{awb-es.0.type.restmuell.naechsterTermin}
```

### Blockly – Benachrichtigung bei Abholung morgen

```
Wenn: awb-es.0.type.restmuell.abholungMorgen = true
Dann: Sende Pushover "Morgen wird der Restmüll abgeholt!"
```

### JavaScript-Beispiel

```javascript
// Tägliche Zusammenfassung
const types = ['restmuell', 'biomuell', 'papier', 'gelberSack'];
const namen = { restmuell: 'Restmüll', biomuell: 'Biomüll', papier: 'Papier', gelberSack: 'Gelber Sack' };

const morgen = types.filter(t => 
    getState(`awb-es.0.type.${t}.abholungMorgen`).val
);

if (morgen.length > 0) {
    const msg = 'Morgen wird abgeholt: ' + morgen.map(t => namen[t]).join(', ');
    sendTo('pushover', msg);
}
```

---

## Fehlerbehebung

### Status zeigt „Keine ICS-URL gefunden"

Der Ort oder die Straße stimmt nicht exakt mit der AWB-Website überein. Lösung:
1. [awb-es.de/abfuhr/abfuhrtermine](https://www.awb-es.de/abfuhr/abfuhrtermine/__Abfuhrtermine.html) aufrufen
2. Ort eingeben und aus dem **Dropdown** auswählen
3. Straße eingeben und aus dem **Dropdown** auswählen
4. Den exakten Text aus dem Dropdown in den Adapter übernehmen

### Status zeigt „Kein Termin gefunden" für einen Abfalltyp

Die Schlüsselwörter passen nicht zum ICS-Kalender deiner Straße. Lösung:
- Den `info.connection`-Datenpunkt prüfen
- Im ioBroker-Log nachschauen, wie die Termine in der ICS-Datei heißen
- Im Adapter-Tab „Abfalltypen" die Schlüsselwörter anpassen

---

## Changelog

### 0.1.0 (2026-05-30)
- Erstveröffentlichung
- Unterstützung aller Gemeinden im Landkreis Esslingen
- Konfigurierbare Abfalltypen mit Schlüsselwort-Matching
- Admin-UI mit JSON-Konfiguration

---

## Lizenz

MIT License – siehe [LICENSE](LICENSE)
