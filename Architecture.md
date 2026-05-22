# PropFirm Trading Farm - System Architecture

Welcome to the **PropFirm Trading Farm** architecture documentation. This document details the three-tier system layout, network protocols, JSON data schemas, dynamic scaling engines, and high-performance concurrency models that enable microsecond-latency trade copy distribution.

---

## 1. System Topology Overview

The system is designed with a highly modular, reactive, three-tier architecture:

```mermaid
graph TD
    subgraph Client Layer (UI)
        UI[Next.js PWA Scalping & Micro Panel]
    end

    subgraph Orchestration Layer (Central Backend)
        BE[FastAPI Asynchronous Gateway]
        WS[WebSocket Server / Connection Manager]
        Copier[Trade Copier & Risk Scaling Engine]
        Config[JSON Config Manager]
        
        BE --- WS
        WS --- Copier
        Copier --- Config
    end

    subgraph Terminal Execution Layer (Bridges)
        B1[MT5 HTTP Bridge 1 - Port 58801]
        B2[MT5 HTTP Bridge 2 - Port 58802]
        B3[MT5 HTTP Bridge 3 - Port 58803]
        B_N[MT5 HTTP Bridge N - Port 5880N]
    end

    subgraph Wine / Windows Containers
        MT1[MetaTrader 5 Client Terminal 1]
        MT2[MetaTrader 5 Client Terminal 2]
        MT3[MetaTrader 5 Client Terminal 3]
        MT_N[MetaTrader 5 Client Terminal N]
    end

    UI <== "WebSocket Protocol (ws://127.0.0.1:9999/ws)" ==> WS
    
    BE <== "Async Parallel HTTP (httpx.AsyncClient)" ==> B1
    BE <== "Async Parallel HTTP (httpx.AsyncClient)" ==> B2
    BE <== "Async Parallel HTTP (httpx.AsyncClient)" ==> B3
    BE <== "Async Parallel HTTP (httpx.AsyncClient)" ==> B_N

    B1 <== "MetaTrader5 Python API (IPC/COM)" ==> MT1
    B2 <== "MetaTrader5 Python API (IPC/COM)" ==> MT2
    B3 <== "MetaTrader5 Python API (IPC/COM)" ==> MT3
    B_N <== "MetaTrader5 Python API (IPC/COM)" ==> MT_N
```

### The Three Tiers
1. **Frontend (Client Layer)**: Built with Next.js 14, standard Tailwind/Vanilla CSS, and HTML5 WebSockets. Offers a sleek, highly responsive PWA Scalping Dashboard and a lightweight Floating/Micro-Scalping Panel designed to run as an independent picture-in-picture widget.
2. **Central Backend (Orchestration Layer)**: An asynchronous FastAPI python engine running on port `9999`. It serves as the single source of truth, managing active client subscriptions, live background polling routines, symbol translations, and parallel execution routing.
3. **MT5 HTTP Bridges (Execution Layer)**: Independent Python web servers (`mt5_http_bridge1.py`, etc.) running directly inside Windows/Wine terminal containers. Each bridge binds to a dedicated port (e.g. `58801`), communicates with its local MT5 terminal via the official `MetaTrader5` Python library, and exposes a standardized JSON HTTP API.

---

## 2. High-Performance Concurrency Engine

The core design principle of the system is **zero block latency**. When scalping, a sequential loop that trades across 10 accounts one-by-one would result in severe slippage.

### 2.1 Asynchronous HTTP Dispatch (`asyncio.gather`)
The Central Backend relies exclusively on Python's **asynchonous execution loops** and `httpx.AsyncClient`. When a trade or portfolio management operation is requested by the UI:

1. The backend parses `propfundsettings.json` and filters all accounts where `"trade_enabled": true`.
2. Rather than iterating over them sequentially, it spawns an asynchronous coroutine task for each active client using an HTTP client.
3. It bundles these tasks together using `asyncio.gather(*tasks, return_exceptions=True)`.
4. The operating system's event loop multiplexes these network requests. They are dispatched to all MT5 bridge endpoints **concurrently in parallel** within the same millisecond.

```python
# Conceptual snapshot of the copier parallel dispatch engine
tasks = []
for acc in active_accounts:
    client = BridgeClient(acc["ip_port"])
    # Schedule non-blocking execution coroutine
    tasks.append(client.execute_trade([trade_payload]))

# Concurrently trigger all HTTP requests parallelly
results = await asyncio.gather(*tasks, return_exceptions=True)
```

### 2.2 Bridge-Side Threaded Concurrency
To ensure that incoming status checks do not block trade executions, the MT5 HTTP Bridge utilizes a multi-threaded socket server:
* Built on top of `socketserver.ThreadingMixIn` and `http.server.HTTPServer`:
  ```python
  class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
      """ Delivers multi-threaded request processing in MT5 Bridge. """
      pass
  ```
* Every incoming request is handled in a separate OS thread, preventing request queue blockages.
* The local MT5 COM/IPC operations are thread-guarded using Python's reentrant locks (`threading.RLock()`), ensuring thread safety without starvation.

---

## 3. UI ↔ Central Backend WebSocket Protocol (`ws://<host>:9999/ws`)

A single, persistent full-duplex WebSocket connection is established between the React client and FastAPI. All interactions, metrics, log feeds, and active parameters are streamed through this link.

### 3.1 Standard Client Request Envelope
All messages sent from the UI client to the Central Backend must follow this exact JSON structure:

```json
{
  "receiver": "proplink",
  "data": {
    "requestId": "cl_req_92813",
    "command": "command_name",
    "payload": {}
  }
}
```

#### Fields:
* `receiver`: Always `"proplink"` (Routing discriminator).
* `requestId`: A unique identifier generated by the client to correlate asynchronous responses.
* `command`: The API action to execute.
* `payload`: A dynamic JSON object containing custom request arguments.

---

### 3.2 List of WebSocket Commands (UI ➡️ Backend)

#### 1. Subscribe to Reference Account Status (`subscribe_account`)
Subscribes the connection to updates from the primary master account.
* **Payload**: `{}`
* **Response**:
  ```json
  {
    "requestId": "cl_req_92813",
    "status": "ok",
    "data": {
      "message": "Subscribed to master reference updates."
    }
  }
  ```

#### 2. Subscribe to Multi-Account Farm (`subscribe_multi_account`)
Subscribes the connection to updates from all configured trading accounts.
* **Payload**: `{}`
* **Response**: Standard success status response.

#### 3. Subscribe to Live spreads (`subscribe_spreads`)
Subscribes the connection to raw tick bid/ask spreads.
* **Payload**: `{}`
* **Response**: Standard success status response.

#### 4. Subscribe to System Activities & Action Logs (`subscribe_logs`)
Subscribes to live system operation events (e.g. execution records, errors).
* **Payload**: `{}`
* **Response**: Instant playback of historical logs (last 300 logs) followed by the success confirmation envelope.

#### 5. Fetch Global Asset Checklist (`get_global_symbols`)
Requests the list of recognized assets and their fallback stop-loss pips.
* **Payload**: `{}`
* **Response**:
  ```json
  {
    "requestId": "cl_req_92817",
    "status": "ok",
    "data": {
      "symbols": ["EURUSD", "GBPUSD", "USDJPY", "EURJPY", "GBPJPY", "SP500", "DAX40", "NQ100", "GOLD"],
      "slpips": {
        "EURUSD": 25.0,
        "GBPUSD": 35.0,
        "USDJPY": 35.0,
        "GOLD": 20.0
      }
    }
  }
  ```

#### 6. Instantly Fetch Current Reference Account Status (`get_account_status`)
Requests a synchronous poll of the reference account.
* **Payload**: `{}`
* **Response**:
  ```json
  {
    "requestId": "cl_req_92818",
    "status": "ok",
    "data": {
      "account": {
        "id": "25325890",
        "type": "MT5",
        "displayName": "25325890 (TickMill_Demo)",
        "status": "Connected",
        "error": null,
        "realizedPNL": 125.40,
        "unrealizedPNL": -85.20,
        "positions": [],
        "orders": [],
        "cash_value": 100125.40,
        "buying_power": 98520.10,
        "multiplier": 10.0,
        "riskPerc": 20.0,
        "trade_enabled": true,
        "lastUpdated": "13:14:02"
      }
    }
  }
  ```

#### 7. Execute Dynamic Trade Request (`trade`)
Requests trade execution across the enabled portfolio farm.
* **Payload**:
  ```json
  {
    "symbol": "EURUSD",
    "direction": "buy",
    "ordertype": "market",
    "qty": 0.0,
    "sl_pips": 25.0,
    "tp_pips": 50.0,
    "offset_pips": 0.0,
    "risk": 2.0
  }
  ```
  > [!NOTE]
  > Passing `qty: 0.0` with a valid `risk` percentage commands the system to dynamically calculate contract sizing based on the target account balance and the stop-loss parameter.
* **Response**:
  ```json
  {
    "requestId": "cl_req_92819",
    "status": "ok",
    "data": {
      "message": "Trades executed. Successful on 3/3 accounts."
    },
    "error": null
  }
  ```

#### 8. Flatten Open Positions (`flatten`)
Instantly closes open deals and deletes active pending orders.
* **Payload**:
  ```json
  {
    "instrument": "EURUSD"
  }
  ```
  > [!TIP]
  > Omitting the `"instrument"` key or passing `null` flattens the **entire portfolio** across all symbols.
* **Response**:
  ```json
  {
    "requestId": "cl_req_92820",
    "status": "ok",
    "data": {
      "message": "Flatten complete across 3 active accounts."
    },
    "error": null
  }
  ```

#### 9. Cancel All Pending Orders (`cancel`)
Cancels all pending orders across all active accounts.
* **Payload**:
  ```json
  {
    "instrument": "EURUSD"
  }
  ```
* **Response**: Standard success status response.

#### 10. Fetch Live ATR (`get_atr`)
Fetches the current ATR value from the reference account bridge.
* **Payload**:
  ```json
  {
    "symbol": "EURUSD"
  }
  ```
* **Response**:
  ```json
  {
    "requestId": "cl_req_92822",
    "status": "ok",
    "data": {
      "success": true,
      "instrument": "EURUSD",
      "atr_raw": 0.00024,
      "atr_pips": 2.4
    },
    "error": null
  }
  ```

#### 11. Modify Active Pending Orders (`modify_order`)
Updates a pending order's price level based on market references.
* **Payload**:
  ```json
  {
    "symbol": "EURUSD",
    "new_price_type": "mid",
    "offset_pips": 2.0
  }
  ```
* **Response**: Standard success response showing accounts modified.

#### 12. Modify Position Protection Levels (`manage_position_stops`)
Dynamically adjusts the SL and TP on an active position.
* **Payload**:
  ```json
  {
    "symbol": "EURUSD",
    "sl": {
      "type": "pips_from_entry",
      "value": 15.0
    },
    "tp": {
      "type": "pips_from_mid",
      "value": 30.0
    }
  }
  ```
* **Response**: Standard success status response.

---

### 3.3 Live Broadcast Streams (Backend ➡️ UI Client)

The central backend publishes live feeds onto specific subscription channels. The UI receives these push events asynchronously:

#### Channel A: Reference Account Status (`"account_update"`)
Triggered automatically every 1 second by a background poller.

```json
{
  "type": "account_update",
  "data": {
    "account": {
      "id": "25325890",
      "type": "MT5",
      "displayName": "25325890 (TickMill)",
      "status": "Connected",
      "error": null,
      "realizedPNL": 350.00,
      "unrealizedPNL": 45.10,
      "positions": [
        {
          "symbol": "EURUSD",
          "displaySymbol": "EURUSD",
          "direction": "BUY",
          "quantity": 2.5,
          "avgPrice": 1.08250,
          "pnl": 45.10
        }
      ],
      "orders": [
        {
          "symbol": "GBPUSD",
          "displaySymbol": "GBPUSD",
          "direction": "BUY",
          "quantity": 1.0,
          "orderType": "limit",
          "price": 1.25400
        }
      ],
      "cash_value": 100350.00,
      "buying_power": 99120.00,
      "multiplier": 10.0,
      "riskPerc": 20.0,
      "trade_enabled": true,
      "lastUpdated": "13:16:04"
    }
  }
}
```

#### Channel B: Multi-Account Status Dashboard (`"multi_account_update"`)
Pushed every 1 second, grouping real-time status parameters for all accounts.

```json
{
  "type": "multi_account_update",
  "data": {
    "accounts": [
      {
        "id": "25325890",
        "status": "Connected",
        "cash_value": 100350.00,
        "buying_power": 99120.00,
        "realizedPNL": 350.00,
        "unrealizedPNL": 45.10,
        "positions": [...],
        "orders": [...],
        "multiplier": 10.0,
        "trade_enabled": true
      },
      {
        "id": "90012751",
        "status": "Disconnected",
        "cash_value": 0.0,
        "buying_power": 0.0,
        "realizedPNL": 0.0,
        "unrealizedPNL": 0.0,
        "positions": [],
        "orders": [],
        "multiplier": 1.0,
        "trade_enabled": false
      }
    ]
  }
}
```

#### Channel C: Spread and Tick Feed (`"spreads_update"`)
Pushed every 1 second. Contains mapped symbol bid/ask spreads.
> [!NOTE]
> To save CPU cycles and network bandwidth, the background spreads poller **automatically sleeps** if there are no active UI subscribers on the spreads channel.

```json
{
  "type": "spreads_update",
  "data": {
    "accounts": [
      {
        "id": "25325890",
        "displayName": "TickMill (25325890)",
        "company": "TickMill",
        "spreads": {
          "EURUSD": 0.00004,
          "GBPUSD": 0.00006,
          "USDJPY": 0.005,
          "GOLD": 0.12
        },
        "defaultpointvalue": {
          "EURUSD": 0.0001,
          "GBPUSD": 0.0001,
          "USDJPY": 0.01,
          "GOLD": 1.0
        }
      }
    ]
  }
}
```

#### Channel D: Log and Action Audit Feed (`"log_update"`)
Pushed in real-time as background events occur.

```json
{
  "type": "log_update",
  "data": {
    "timestamp": "13:16:05",
    "message": "UI placement requested: BUY EURUSD (scaled risk, SL 25 pips)",
    "source": "UI-WS",
    "type": "trade"
  }
}
```

---

## 4. Central Backend ↔ MT5 HTTP Bridge Protocol

The communication between the Central Backend and each MT5 HTTP Bridge uses **synchronous/blocking HTTP POST requests**. The backend translates high-level global requests into specific broker formats before dispatching.

### 4.1 Standard Request/Response Format
All payload structures require the command name to be passed in a root-level property named `"request"`.

* **Generic Request Envelope**:
  ```json
  {
    "request": "command_name",
    "param1": "value1"
  }
  ```
* **Generic Response Envelope**:
  ```json
  {
    "success": true,
    "error": null,
    "...": "custom properties"
  }
  ```

---

### 4.2 Bridge Endpoint API Commands

#### 1. Fetch Account Status (`accountstatus`)
* **Request Payload**:
  ```json
  {
    "request": "accountstatus"
  }
  ```
* **Response Payload**:
  ```json
  {
    "accounts": [
      {
        "account": "25325890",
        "total_unrealized": 0.0,
        "total_realized": 120.50,
        "cash_value": 100120.50,
        "buying_power": 99820.00,
        "trading_disabled_today": false,
        "positions": [
          {
            "instrument": "EURUSD.pro",
            "quantity": 1.5,
            "direction": "buy",
            "avgprice": 1.08200,
            "PNL": 35.00
          }
        ],
        "orders": [
          {
            "instrument": "GBPUSD.pro",
            "direction": "sell",
            "ordertype": "limit",
            "quantity": 1.0,
            "price": 1.25800
          }
        ]
      }
    ]
  }
  ```

#### 2. Get Live Spreads (`getspreads`)
* **Request Payload**:
  ```json
  {
    "request": "getspreads",
    "instruments": ["EURUSD.pro", "GBPUSD.pro"]
  }
  ```
* **Response Payload**:
  ```json
  {
    "success": true,
    "accounts": [
      {
        "account": "25325890",
        "spreads": {
          "EURUSD.pro": 0.00003,
          "GBPUSD.pro": 0.00005
        }
      }
    ]
  }
  ```

#### 3. Execute Trade Order (`trade`)
* **Request Payload**:
  ```json
  {
    "request": "trade",
    "trades": [
      {
        "instrument": "EURUSD.pro",
        "direction": "buy",
        "ordertype": "market",
        "qty": 1.5,
        "sl_pips": 0.00250,
        "tp_pips": 0.00500,
        "offset_pips": 0.0,
        "risk": 0.0
      }
    ]
  }
  ```
  > [!IMPORTANT]
  > Note that stop-loss (`sl_pips`), take-profit (`tp_pips`), and `offset_pips` values have already been converted from global pips (e.g. `25.0`) to absolute price differentials (e.g. `0.00250`) by the backend scaling engine prior to dispatching.
* **Response Payload**:
  ```json
  {
    "success": true,
    "results": [
      {
        "instrument": "EURUSD.pro",
        "success": true,
        "calculatedVolume": 1.5,
        "orderId": "8729102",
        "error": null
      }
    ]
  }
  ```

#### 4. Cancel Pending Orders & Close Open Positions (`cancelandflatten`)
* **Request Payload**:
  ```json
  {
    "request": "cancelandflatten",
    "instrument": "EURUSD.pro"
  }
  ```
* **Response Payload**:
  ```json
  {
    "success": true,
    "message": "Closed 1 position, cancelled 0 orders for EURUSD.pro"
  }
  ```

#### 5. Modify Active Stop Loss & Take Profit (`manage_position_stops`)
* **Request Payload**:
  ```json
  {
    "request": "manage_position_stops",
    "payload": {
      "symbol": "EURUSD.pro",
      "sl": {
        "type": "pips_from_entry",
        "value": 0.00150
      },
      "tp": {
        "type": "pips_from_mid",
        "value": 0.00300
      }
    }
  }
  ```
* **Response Payload**:
  ```json
  {
    "success": true,
    "message": "Position 928138 SL/TP updated."
  }
  ```

#### 6. Fetch Local Terminal ATR Indicator (`getatr`)
* **Request Payload**:
  ```json
  {
    "request": "getatr",
    "instrument": "EURUSD.pro"
  }
  ```
* **Response Payload**:
  ```json
  {
    "success": true,
    "instrument": "EURUSD.pro",
    "atr": 0.00025
  }
  ```

---

## 5. Risk Scaling & Symbol Translation Engine

Different brokers and account sizes have different execution requirements. The copier handles these conversions transparently using parameters in `propfundsettings.json`.

```
[UI Global Instrument] (e.g., EURUSD)
         │
         ├──► Translate Name: "EURUSD" ──► "EURUSD.pro" (Broker specific symbol)
         │
         ├──► Convert Sl/Tp Pips: 25.0 Pips * 0.0001 (Point Value) ──► 0.00250 Price Diff
         │
         └──► Volume Sizing Engine:
                  ├──► If IsRiskBased:
                  │        Lots = (Balance * Risk%) / (SL * ContractSize * ConversionRate)
                  └──► If Fixed Sizing:
                           Lots = GlobalQty * Multiplier
```

### 5.1 Name Conversions
Global names are mapped to specific broker symbols using `NameConversions` mappings. For example:
* UI instrument `EURUSD` maps to `EURUSD.pro` for Account A, and `EURUSD.pi` for Account B.
* Passing `"N/A"` as a conversion target acts as a safeguard. The engine will skip trading that asset on that account.

### 5.2 Stop Loss Safeguard
To prevent accidental oversized risk exposures, the central backend enforces a **C++ Safeguard Rule** on trade placements:
* The system checks `DefaultSLPips` for the symbol in `propfundsettings.json`.
* If a trade request is received with `sl_pips` lower than the configured threshold, or if `sl_pips` is omitted, the copier automatically overrides and scales the stop loss up to the default floor value.

### 5.3 Volume Sizing Logic
The engine supports two primary sizing modes for trade copy operations:

#### Mode 1: Multiplier-Based Sizing (Fixed Lots)
Sizing is calculated by multiplying the base trade size by the account's configured multiplier:
$$\text{Account Lots} = \text{UI Requested Lots} \times \text{Account Multiplier}$$
*If the base lot is 0, the system falls back to the account's configured `DefaultLotSizes` value.*

#### Mode 2: Dynamic Risk-Based Sizing
If an account is configured with `"IsRiskBased": true`, the copier calculates exact risk-adjusted volume:
1. The backend fetches the current account balance and conversion rates.
2. The trade volume is calculated using the stop-loss level, contract size, and currency conversion rate:
$$\text{Calculated Volume} = \frac{\text{Account Balance} \times \text{Risk Perc}}{\text{Stop Loss (Price Diff)} \times \text{Contract Size} \times \text{Conversion Rate}}$$
3. The calculated volume is normalized on the bridge to comply with broker limits (`volume_min`, `volume_max`, `volume_step`).

---

## 6. Port & Service Network Configuration

Here is a summary of the network port configurations for the system:

| Service | Port / Protocol | Configuration Location | Purpose |
| :--- | :--- | :--- | :--- |
| **Central Backend** | `9999` (TCP WebSocket) | `backend/websocket_server.py` | UI Connection Interface & Event Broadcaster |
| **MT5 HTTP Bridge 1** | `58801` (HTTP POST) | `scripts/propfundsettings.json` | Terminal Interface for Account 25325890 |
| **MT5 HTTP Bridge 2** | `58803` (HTTP POST) | `scripts/propfundsettings.json` | Terminal Interface for Account 90012751 |
| **MT5 HTTP Bridge 3** | `58804` (HTTP POST) | `scripts/propfundsettings.json` | Terminal Interface for Account 873048 |
| **Futures Bridge** | `58800` (HTTP POST) | `scripts/propfundsettings.json` | Gateway to futures terminals |

---
