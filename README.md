# ioBroker.alerting

Generischer ioBroker-Adapter für regelbasierte Alarmierungen.

Der Adapter prüft konfigurierte Regeln bei jeder Änderung eines verwendeten States. Eine Regel kann verschachtelte `and`/`or`/`not`-Bedingungen enthalten. Wenn eine Regel greift, kann der Adapter Nachrichten über installierte ioBroker-Adapter senden und zusätzlich States als Konsequenz setzen.

## Funktionen

- Prüfung bei Änderung jedes in einer Regel verwendeten States
- Verschachtelte Kriterien mit `and`, `or` und `not`
- Vergleich gegen feste Werte oder gegen einen anderen State
- Versand über generische `sendTo`-Kanäle, z. B. `telegram.0`, `pushover.0`, `open-wa.0`
- Alternativer Versand durch Schreiben in einen State, z. B. `mqtt.0.whatsapp.outgoing`
- Maximale Anzahl Nachrichten pro aktiver Regelphase
- Mindestabstand zwischen Nachrichten
- Automatischer Reset von Zähler und Sperre, sobald die Regel nicht mehr greift
- Optionale State-Aktionen bei `onTrue`, `everyTrue` und `onFalse`

## Installation während der Entwicklung

```bash
cd /opt/iobroker
npm install https://github.com/radebold/ioBroker.Alerting/tarball/main
iobroker add alerting
```

Lokale Entwicklung:

```bash
git clone https://github.com/radebold/ioBroker.Alerting.git
cd ioBroker.Alerting
npm install
npm test
```

## Konfiguration

Die erste Version verwendet im Admin ein JSON-Feld `rulesJson`. Das ist bewusst einfach gehalten, damit die Regel-Engine sofort verschachtelte UND/ODER-Logik unterstützt. Eine spätere Version kann daraus einen grafischen Rule-Builder machen.

## Beispielregel: Telegram + State-Aktion

```json
[
  {
    "id": "pool_ph_alarm",
    "name": "Pool pH zu hoch",
    "enabled": true,
    "condition": {
      "op": "and",
      "items": [
        {
          "state": "ph803w.0.N7EtmEWYCMVBROOHzkV9zT.ph.value",
          "operator": ">",
          "value": 7.4,
          "valueType": "number"
        },
        {
          "state": "sonoff.0.SonoffSP18.POWER",
          "operator": "eq",
          "value": true,
          "valueType": "boolean"
        }
      ]
    },
    "message": {
      "title": "Pool Alarm",
      "text": "pH ist zu hoch: ${state:ph803w.0.N7EtmEWYCMVBROOHzkV9zT.ph.value}"
    },
    "limits": {
      "maxMessages": 3,
      "minIntervalSec": 900
    },
    "channels": [
      {
        "type": "sendTo",
        "enabled": true,
        "instance": "telegram.0",
        "command": "send",
        "payload": {
          "text": "${message.title}: ${message.text}"
        }
      }
    ],
    "actions": [
      {
        "type": "setState",
        "enabled": true,
        "when": "onTrue",
        "state": "0_userdata.0.Alarm.PoolPH.active",
        "value": true,
        "valueType": "boolean",
        "ack": false
      },
      {
        "type": "setState",
        "enabled": true,
        "when": "onFalse",
        "state": "0_userdata.0.Alarm.PoolPH.active",
        "value": false,
        "valueType": "boolean",
        "ack": false
      }
    ]
  }
]
```

## Beispielregel: UND/ODER-Kombination + Pushover

```json
[
  {
    "id": "haus_alarm",
    "name": "Haus Alarm",
    "enabled": true,
    "condition": {
      "op": "and",
      "items": [
        {
          "state": "0_userdata.0.Anwesenheit.Karin",
          "operator": "eq",
          "value": false,
          "valueType": "boolean"
        },
        {
          "op": "or",
          "items": [
            {
              "state": "hm-rpc.0.FensterKeller.STATE",
              "operator": "eq",
              "value": true,
              "valueType": "boolean"
            },
            {
              "state": "hm-rpc.0.BewegungGarage.MOTION",
              "operator": "eq",
              "value": true,
              "valueType": "boolean"
            }
          ]
        }
      ]
    },
    "message": {
      "title": "Haus Alarm",
      "text": "Alarmregel greift. Auslöser: ${changed.id} = ${changed.value}"
    },
    "limits": {
      "maxMessages": 2,
      "minIntervalSec": 300
    },
    "channels": [
      {
        "type": "sendTo",
        "enabled": true,
        "instance": "pushover.0",
        "command": "send",
        "payload": {
          "title": "${message.title}",
          "message": "${message.text}",
          "priority": 1
        }
      }
    ]
  }
]
```

## Beispielregel: WhatsApp über MQTT-State

Das passt zu Gateways, bei denen ein JSON-Payload in einen ioBroker-State geschrieben wird, z. B. `mqtt.0.whatsapp.outgoing`.

```json
[
  {
    "id": "frigate_tieralarm",
    "name": "Frigate Tieralarm",
    "enabled": true,
    "condition": {
      "op": "and",
      "items": [
        {
          "state": "0_userdata.0.Frigate.ElsterBewaesserung.Aktiv",
          "operator": "eq",
          "value": true,
          "valueType": "boolean"
        },
        {
          "state": "0_userdata.0.Frigate.ElsterBewaesserung.Laueft",
          "operator": "eq",
          "value": true,
          "valueType": "boolean"
        }
      ]
    },
    "message": {
      "title": "Tierabwehr aktiv",
      "text": "Bewässerung wurde gestartet. Grund: ${state:0_userdata.0.Frigate.ElsterBewaesserung.LetzterGrund}"
    },
    "limits": {
      "maxMessages": 1,
      "minIntervalSec": 600
    },
    "channels": [
      {
        "type": "state",
        "enabled": true,
        "state": "mqtt.0.whatsapp.outgoing",
        "valueType": "json",
        "ack": false,
        "value": "{\"to\":\"DEINE_GRUPPE_ODER_NUMMER\",\"text\":\"${message.title}: ${message.text}\"}"
      }
    ]
  }
]
```

## Bedingungen

### Gruppen

```json
{
  "op": "and",
  "items": []
}
```

Unterstützte Gruppen:

- `and`
- `or`
- `not` mit genau einem Eintrag in `items`

### Einzelbedingung

```json
{
  "state": "adapter.0.state",
  "operator": "eq",
  "value": true,
  "valueType": "boolean"
}
```

Alternativ kann gegen einen anderen State verglichen werden:

```json
{
  "state": "sensor.0.temperature",
  "operator": ">",
  "valueState": "0_userdata.0.Schwellwerte.TemperaturMax",
  "valueType": "number"
}
```

Unterstützte Operatoren:

- `eq`, `==`, `=`
- `ne`, `!=`, `<>`
- `gt`, `>`
- `gte`, `>=`
- `lt`, `<`
- `lte`, `<=`
- `contains`
- `notContains`
- `regex`
- `exists`
- `notExists`
- `isEmpty`
- `notEmpty`
- `isTrue`, `true`
- `isFalse`, `false`

Unterstützte `valueType`-Werte:

- `auto`
- `number`
- `boolean`
- `string`
- `json`

## Nachrichtenbegrenzung

`limits.maxMessages` gilt pro aktiver Phase einer Regel. Eine aktive Phase beginnt, wenn die Regel von `false` auf `true` wechselt. Sobald die Regel wieder `false` wird, werden `sentCount`, `lastSent` und die Sperre zurückgesetzt.

`limits.minIntervalSec` legt den Mindestabstand zwischen zwei Nachrichten derselben Regel fest.

## Platzhalter

In `message`, `payload` und `actions.value` können Platzhalter verwendet werden:

- `${rule.id}`
- `${rule.name}`
- `${message.title}`
- `${message.text}`
- `${changed.id}`
- `${changed.value}`
- `${now}`
- `${state:adapter.0.stateId}`

## Channels

### `sendTo`

```json
{
  "type": "sendTo",
  "instance": "telegram.0",
  "command": "send",
  "payload": {
    "text": "${message.text}"
  }
}
```

### `state`

```json
{
  "type": "state",
  "state": "mqtt.0.whatsapp.outgoing",
  "valueType": "json",
  "ack": false,
  "value": "{\"to\":\"12345@c.us\",\"text\":\"${message.text}\"}"
}
```

## Actions

```json
{
  "type": "setState",
  "when": "onTrue",
  "state": "0_userdata.0.Alarm.Aktiv",
  "value": true,
  "valueType": "boolean",
  "ack": false
}
```

Unterstützte Zeitpunkte:

- `onTrue`: einmal beim Wechsel von nicht aktiv auf aktiv
- `everyTrue`: bei jeder erfolgreichen Prüfung, solange die Regel aktiv ist
- `onFalse`: einmal beim Wechsel von aktiv auf nicht aktiv

## Entwicklungsnotizen

Diese erste Version ist bewusst klein gehalten:

- keine externen Runtime-Abhängigkeiten außer `@iobroker/adapter-core`
- Admin-Konfiguration über JSON-Feld
- generischer `sendTo`-Mechanismus statt fester Abhängigkeit von Telegram, Pushover, open-wa oder WhatsApp

Geplante sinnvolle Erweiterungen:

- grafischer Rule-Builder im Admin
- Test-Button je Regel
- Import/Export für Regeln
- optionale Tageszeit-/Wochentagsbedingungen
- eigene History je Regel
- Kanal-Presets für Telegram, Pushover, open-wa, WhatsApp-CMB und MQTT
