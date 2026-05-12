# ioBroker.alerting

Generischer ioBroker-Adapter für regelbasierte Alarmierungen.

Der Adapter prüft konfigurierte Regeln bei jeder Änderung eines verwendeten States. Wenn eine Regel greift, kann er Nachrichten über installierte ioBroker-Adapter versenden und zusätzlich States als Konsequenz setzen.

## Funktionen

- Admin-Konfiguration über einzelne Tabellen/Felder statt Pflicht-JSON
- Prüfung bei Änderung jedes in einer Regel verwendeten States
- UND/ODER-Regeln mit optionalen Gruppen
- Vergleich gegen feste Werte oder gegen einen anderen State
- Nachrichtentitel und Nachrichtentext pro Regel frei definierbar
- Platzhalter im Nachrichtentext, z. B. `${changed.id}`, `${changed.value}` oder `${state:adapter.0.state}`
- Versand über generische `sendTo`-Kanäle, z. B. `telegram.0`, `pushover.0`, `open-wa.0`
- Alternativer Versand durch Schreiben in einen State
- JSON-Nachricht aus Einzelfeldern bauen und in einen State schreiben, z. B. für MQTT-/WhatsApp-Gateways
- Maximale Anzahl Nachrichten pro aktiver Regelphase
- Mindestabstand zwischen Nachrichten
- Automatischer Reset von Zähler und Sperre, sobald die Regel nicht mehr greift
- Optionale State-Aktionen bei `onTrue`, `everyTrue` und `onFalse`
- Legacy-JSON bleibt im Experten-Tab als Fallback erhalten

## Installation während der Entwicklung

```bash
cd /opt/iobroker
npm install https://github.com/radebold/ioBroker.alerting/tarball/main
iobroker add alerting
```

Lokale Entwicklung:

```bash
git clone https://github.com/radebold/ioBroker.alerting.git
cd ioBroker.alerting
npm install
npm test
```

## Konfiguration ohne JSON

Die normale Konfiguration erfolgt über vier Tabellen:

1. **Rules**: Grunddaten der Regel, Nachricht und Limits
2. **Criteria**: Bedingungen/Kriterien der Regel
3. **Channels**: Versandwege
4. **Actions**: optionale State-Aktionen

Wichtig: Die Spalte **Rule ID** verbindet die Tabellen miteinander. Wenn die Regel in der Tabelle `Rules` die ID `pool_ph_alarm` hat, müssen Kriterien, Kanäle und Aktionen ebenfalls `pool_ph_alarm` in der Spalte `Rule ID` verwenden.

## Rules

Pro Regel wird eine Zeile angelegt.

| Feld | Bedeutung |
| --- | --- |
| Active | Regel aktiv/inaktiv |
| Rule ID | Eindeutige technische ID, z. B. `pool_ph_alarm` |
| Name | Anzeigename |
| Root logic | Verknüpfung der direkten Kriterien/Gruppen: `AND` oder `OR` |
| Message title | Nachrichtentitel |
| Message text | Nachrichtentext mit Platzhaltern |
| Max messages | Maximale Nachrichten pro aktiver Phase |
| Interval (s) | Mindestabstand zwischen Nachrichten |

Beispiel Nachrichtentext:

```text
pH ist zu hoch: ${state:ph803w.0.N7EtmEWYCMVBROOHzkV9zT.ph.value}
Auslöser: ${changed.id} = ${changed.value}
```

## Criteria

Pro Bedingung wird eine Zeile angelegt.

| Feld | Bedeutung |
| --- | --- |
| Rule ID | Muss zur Regel-ID passen |
| Group | Optionaler Gruppenname |
| Group logic | Verknüpfung innerhalb derselben Gruppe: `AND` oder `OR` |
| NOT | Bedingung invertieren |
| State | Zu prüfender State |
| Operator | Vergleichsoperator |
| Compare with | Fester Wert oder anderer State |
| Value | Fester Vergleichswert |
| Value state | State, gegen den verglichen wird |
| Value type | `auto`, `number`, `boolean`, `string`, `json` |

### Einfache UND-Regel

Regel `pool_ph_alarm`, Root logic `AND`.

| Rule ID | State | Operator | Value | Value type |
| --- | --- | --- | --- | --- |
| pool_ph_alarm | `ph803w.0.N7EtmEWYCMVBROOHzkV9zT.ph.value` | `>` | `7.4` | `number` |
| pool_ph_alarm | `sonoff.0.SonoffSP18.POWER` | `=` | `true` | `boolean` |

Ergebnis:

```text
pH > 7.4 UND Pumpe ist EIN
```

### Kombination aus AND/OR

Beispiel: Karin ist nicht zuhause **UND** entweder Fenster Keller offen **ODER** Bewegung Garage.

Regel `haus_alarm`, Root logic `AND`.

| Rule ID | Group | Group logic | State | Operator | Value | Value type |
| --- | --- | --- | --- | --- | --- | --- |
| haus_alarm |  | OR | `0_userdata.0.Anwesenheit.Karin` | `=` | `false` | `boolean` |
| haus_alarm | `ausloeser` | OR | `hm-rpc.0.FensterKeller.STATE` | `=` | `true` | `boolean` |
| haus_alarm | `ausloeser` | OR | `hm-rpc.0.BewegungGarage.MOTION` | `=` | `true` | `boolean` |

Ergebnis:

```text
Karin nicht zuhause UND (Fenster Keller offen ODER Bewegung Garage)
```

## Channels

Ein Kanal gehört über **Rule ID** zu einer Regel.

### sendTo adapter

Für Telegram, Pushover, open-wa oder andere Adapter, die über `sendTo` angesprochen werden.

| Feld | Bedeutung |
| --- | --- |
| Type | `sendTo adapter` |
| sendTo instance | z. B. `telegram.0`, `pushover.0`, `open-wa.0` |
| sendTo command | meist `send` |
| Recipient field | optional, z. B. `to`, `user`, `phone` |
| Recipient | optionaler Empfänger |
| Title field | optional, z. B. `title` |
| Text field | z. B. `text` oder `message` |
| Extra 1/2 | optionale Zusatzfelder |

Telegram-Beispiel:

| Feld | Wert |
| --- | --- |
| Type | `sendTo adapter` |
| sendTo instance | `telegram.0` |
| sendTo command | `send` |
| Text field | `text` |
| Text template | `${message.title}: ${message.text}` |

Pushover-Beispiel:

| Feld | Wert |
| --- | --- |
| Type | `sendTo adapter` |
| sendTo instance | `pushover.0` |
| sendTo command | `send` |
| Title field | `title` |
| Title template | `${message.title}` |
| Text field | `message` |
| Text template | `${message.text}` |
| Extra 1 field | `priority` |
| Extra 1 value | `1` |

### Write value to state

Schreibt einen einzelnen Wert in einen State.

| Feld | Wert |
| --- | --- |
| Type | `Write value to state` |
| Target state | `0_userdata.0.Alarm.LastText` |
| State value type | `string` |
| State value | `${message.title}: ${message.text}` |

### Write JSON message to state

Baut eine JSON-Nachricht aus Einzelfeldern und schreibt sie in einen State. Das ist nützlich für MQTT-/WhatsApp-Gateways.

Beispiel für `mqtt.0.whatsapp.outgoing`:

| Feld | Wert |
| --- | --- |
| Type | `Write JSON message to state` |
| Target state | `mqtt.0.whatsapp.outgoing` |
| State value type | `string` |
| Recipient field | `to` |
| Recipient | `DEINE_GRUPPE_ODER_NUMMER` |
| Text field | `text` |
| Text template | `${message.title}: ${message.text}` |

Der Adapter schreibt dann sinngemäß:

```json
{"to":"DEINE_GRUPPE_ODER_NUMMER","text":"Alarm: Text"}
```

als String in den Ziel-State.

## Actions

Aktionen setzen optional einen State als Konsequenz einer Regel.

| Feld | Bedeutung |
| --- | --- |
| Rule ID | Muss zur Regel-ID passen |
| When | `onTrue`, `everyTrue` oder `onFalse` |
| Target state | Zu setzender State |
| Value | Wert, auch mit Platzhaltern möglich |
| Value type | `auto`, `number`, `boolean`, `string`, `json` |
| Ack | Ack-Flag für `setForeignState` |

Beispiel:

| Feld | Wert |
| --- | --- |
| Rule ID | `pool_ph_alarm` |
| When | `onTrue` |
| Target state | `0_userdata.0.Alarm.PoolPH.active` |
| Value | `true` |
| Value type | `boolean` |

Reset-Aktion:

| Feld | Wert |
| --- | --- |
| Rule ID | `pool_ph_alarm` |
| When | `onFalse` |
| Target state | `0_userdata.0.Alarm.PoolPH.active` |
| Value | `false` |
| Value type | `boolean` |

## Nachrichtenbegrenzung

`Max messages` gilt pro aktiver Phase einer Regel. Eine aktive Phase beginnt, wenn die Regel von `false` auf `true` wechselt. Sobald die Regel wieder `false` wird, werden `sentCount`, `lastSent` und die Sperre zurückgesetzt.

`Interval (s)` legt den Mindestabstand zwischen zwei Nachrichten derselben Regel fest.

## Platzhalter

In Nachrichtentitel, Nachrichtentext, Kanal-Templates und Action-Werten können Platzhalter verwendet werden:

| Platzhalter | Bedeutung |
| --- | --- |
| `${rule.id}` | Regel-ID |
| `${rule.name}` | Regelname |
| `${message.title}` | Gerenderter Nachrichtentitel |
| `${message.text}` | Gerenderter Nachrichtentext |
| `${changed.id}` | State, dessen Änderung die Prüfung ausgelöst hat |
| `${changed.value}` | Neuer Wert dieses States |
| `${now}` | Zeitstempel als ISO-String |
| `${state:adapter.0.stateId}` | Aktueller Wert eines beliebigen verwendeten States |

## Operatoren

Unterstützt werden:

- `=`
- `!=`
- `>`
- `>=`
- `<`
- `<=`
- `contains`
- `not contains`
- `regex`
- `exists`
- `not exists`
- `empty`
- `not empty`
- `true`
- `false`

## Legacy JSON

Im Tab **Expert** gibt es weiterhin `Legacy rules JSON`. Dieses Feld wird nur verwendet, wenn in der Tabelle **Rules** keine Regeln angelegt sind. Damit bleiben ältere Konfigurationen kompatibel.
