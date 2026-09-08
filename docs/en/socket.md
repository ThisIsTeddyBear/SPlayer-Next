# WebSocket API

The WebSocket interface adds realtime bidirectional communication to the [HTTP API](/en/api): clients can send controls and receive playback events.

::: warning Disabled by default
Enable **Settings → External API**, then enable WebSocket separately. Connections require the same access token as HTTP, even on loopback. LAN traffic is unencrypted; use only trusted networks.
:::

## Connection

- **URL:** `ws://127.0.0.1:<port>/ws`
- **Default port:** `14558`, shared with HTTP

```javascript
const token = "<copy your access token from Settings → External API>";
const ws = new WebSocket("ws://127.0.0.1:14558/ws", ["splayer-api", `splayer-token.${token}`]);
```

## Server to client

Browser clients send the token using the subprotocols shown above. Native clients may instead send `Authorization: Bearer <token>` in the upgrade request. The server never returns the token as its selected subprotocol. URL query tokens are not accepted.

Replacing the access token, disabling WebSocket, or restarting the server disconnects existing clients. Reconnect using the current token. Limits: 32 clients, 16 KiB messages, 30 commands per second per client, and 8 pending commands per client. Slow consumers are disconnected once their buffered output exceeds 1 MiB.

Every message has a `kind` field:

| `kind`  | Shape                                 | Description                              |
| ------- | ------------------------------------- | ---------------------------------------- |
| `hello` | `{ "kind": "hello", "clients": N }`   | Sent on connection with the client count |
| `event` | `{ "kind": "event", "type", "data" }` | Playback event                           |
| `ack`   | `{ "kind": "ack", "op" }`             | Command succeeded                        |
| `error` | `{ "kind": "error", "op", "error" }`  | Command failed                           |

## Client to server

Commands are JSON objects identified by `op`:

```json
{ "op": "play" }
```

| `op`        | Additional fields          | Description            |
| ----------- | -------------------------- | ---------------------- |
| `play`      | —                          | Play                   |
| `pause`     | —                          | Pause                  |
| `stop`      | —                          | Stop                   |
| `next`      | —                          | Next track             |
| `prev`      | —                          | Previous track         |
| `seek`      | `{ "positionMs": number }` | Seek in milliseconds   |
| `setVolume` | `{ "volume": number }`     | Set volume from 0 to 1 |

Invalid JSON or an unknown `op` receives an error message.

## Example

```javascript
const token = "<copy your access token from Settings → External API>";
const ws = new WebSocket("ws://127.0.0.1:14558/ws", ["splayer-api", `splayer-token.${token}`]);

ws.onopen = () => {
  ws.send(JSON.stringify({ op: "pause" }));
  ws.send(JSON.stringify({ op: "seek", positionMs: 60000 }));
};

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  switch (message.kind) {
    case "hello":
      console.log("Connected clients:", message.clients);
      break;
    case "event":
      console.log("Playback event:", message.type, message.data);
      break;
    case "ack":
      console.log("Command succeeded:", message.op);
      break;
    case "error":
      console.warn("Command failed:", message.op, message.error);
      break;
  }
};
```
