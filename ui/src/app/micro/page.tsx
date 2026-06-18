"use client";

import { useEffect, useRef, useState } from "react";
import { 
  TrendingUp, 
  TrendingDown, 
  X, 
  Activity, 
  AlertCircle, 
  Check, 
  ExternalLink,
  ChevronDown
} from "lucide-react";

export default function MicroPanel() {
  // WebSocket State
  const [wsStatus, setWsStatus] = useState<"connecting" | "connected" | "disconnected">("connecting");
  const [symbols, setSymbols] = useState<string[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState<string>("");
  const [atrPips, setAtrPips] = useState<number | null>(null);
  const [isFetchingAtr, setIsFetchingAtr] = useState<boolean>(false);
  const [totalPnL, setTotalPnL] = useState<number | null>(null);
  const [cashValue, setCashValue] = useState<number | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [message, setMessage] = useState<{ text: string; type: "success" | "danger" | "info" | "warning" | null }>({ text: "", type: null });
  const [pnlPulse, setPnlPulse] = useState<"up" | "down" | null>(null);
  const [isMounted, setIsMounted] = useState<boolean>(false);

  const wsRef = useRef<WebSocket | null>(null);
  const pendingRequests = useRef<Record<string, { resolve: (val: any) => void; reject: (err: any) => void; timeout: NodeJS.Timeout }>>({});
  const previousPnL = useRef<number | null>(null);
  const messageTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const selectRef = useRef<HTMLSelectElement>(null);
  const buyBtnRef = useRef<HTMLButtonElement>(null);
  const sellBtnRef = useRef<HTMLButtonElement>(null);
  const flattenBtnRef = useRef<HTMLButtonElement>(null);

  const selectedSymbolRef = useRef<string>("");
  useEffect(() => {
    selectedSymbolRef.current = selectedSymbol;
  }, [selectedSymbol]);

  // Helper to show status logs or alerts
  const showStatus = (text: string, type: "success" | "danger" | "info" | "warning", duration = 4000) => {
    if (messageTimeoutRef.current) clearTimeout(messageTimeoutRef.current);
    setMessage({ text, type });
    if (duration > 0) {
      messageTimeoutRef.current = setTimeout(() => {
        setMessage({ text: "", type: null });
      }, duration);
    }
  };

  // WebSocket Connection Core
  const connectWS = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;

    setWsStatus("connecting");
    const host = typeof window !== "undefined" ? window.location.hostname : "127.0.0.1";
    const WS_URL = `ws://${host}:9999/ws`;

    try {
      const socket = new WebSocket(WS_URL);
      wsRef.current = socket;

      socket.onopen = () => {
        setWsStatus("connected");
        showStatus("Server Connected", "success", 2000);

        // 1. Fetch initial reference status to show PNL
        sendRequest("get_account_status")
          .then(data => {
            if (data?.account) {
              setTotalPnL(data.account.unrealizedPNL);
              setCashValue(data.account.cash_value);
              setLastUpdated(new Date().toLocaleTimeString());
            }
          })
          .catch(err => console.error("Failed to fetch initial PNL:", err));

        // 2. Fetch global symbols list
        sendRequest("get_global_symbols")
          .then(data => {
            if (data?.symbols) {
              setSymbols(data.symbols);
            }
          })
          .catch(err => console.error("Failed to fetch symbols:", err));

        // 3. Subscribe to active channels
        sendRequest("subscribe_account").catch(e => console.error("Sub error:", e));
        sendRequest("subscribe_logs").catch(e => console.error("Sub error:", e));
        sendRequest("subscribe_atr").catch(e => console.error("Sub error:", e));
      };

      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);

          // Handle response to explicit request Promises
          if (payload.requestId && pendingRequests.current[payload.requestId]) {
            const { resolve, reject, timeout } = pendingRequests.current[payload.requestId];
            clearTimeout(timeout);
            
            if (payload.status === "ok") {
              resolve(payload.data);
            } else {
              reject(payload.error || "Server error response");
            }
            delete pendingRequests.current[payload.requestId];
          } 
          // Handle pushed updates
          else if (payload.type) {
            switch (payload.type) {
              case "account_update":
                if (payload.data?.account) {
                  const currentPnL = payload.data.account.unrealizedPNL;
                  const currentCash = payload.data.account.cash_value;
                  setCashValue(currentCash);
                  setTotalPnL(prev => {
                    if (prev !== null && prev !== currentPnL) {
                      setPnlPulse(currentPnL > prev ? "up" : "down");
                      setTimeout(() => setPnlPulse(null), 800);
                    }
                    return currentPnL;
                  });
                  setLastUpdated(new Date().toLocaleTimeString());
                }
                break;
              case "log_update":
                if (payload.data?.message) {
                  const msgText = payload.data.message;
                  const isErr = /error|fail|invalid/i.test(msgText);
                  const isSuccess = /success|executed|filled/i.test(msgText);
                  showStatus(
                    msgText, 
                    isErr ? "danger" : isSuccess ? "success" : "info",
                    isErr ? 6000 : 3000
                  );
                }
                break;
              case "atr_update":
                if (payload.data?.atr) {
                  const atrData = payload.data.atr;
                  const currentSymbol = selectedSymbolRef.current;
                  if (currentSymbol && atrData[currentSymbol]) {
                    setAtrPips(parseFloat(atrData[currentSymbol].atr_pips));
                  }
                }
                break;
            }
          }
        } catch (error) {
          console.error("Failed to parse WebSocket message:", error);
        }
      };

      socket.onerror = (e) => {
        console.error("WebSocket error:", e);
        setWsStatus("disconnected");
        showStatus("Connection Error", "danger", 0);
      };

      socket.onclose = () => {
        setWsStatus("disconnected");
        showStatus("Disconnected. Reconnecting...", "warning", 0);
        
        // Clean up pending requests
        Object.values(pendingRequests.current).forEach(p => p.reject("WebSocket Closed"));
        pendingRequests.current = {};

        // Automatic reconnect in 5 seconds
        setTimeout(connectWS, 5000);
      };
    } catch (err) {
      console.error("WebSocket setup exception:", err);
      setWsStatus("disconnected");
    }
  };

  // Promise Wrapper for sending WebSocket commands
  const sendRequest = (command: string, payload: any = {}): Promise<any> => {
    return new Promise((resolve, reject) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        return reject("Socket not connected");
      }

      const requestId = Math.random().toString(36).substring(2, 11);
      const msg = {
        receiver: "proplink",
        data: {
          requestId,
          command,
          payload
        }
      };

      const timeout = setTimeout(() => {
        if (pendingRequests.current[requestId]) {
          pendingRequests.current[requestId].reject("Request Timeout");
          delete pendingRequests.current[requestId];
        }
      }, 10000);

      pendingRequests.current[requestId] = { resolve, reject, timeout };
      wsRef.current.send(JSON.stringify(msg));
    });
  };

  // Fetch ATR on symbol selection
  const fetchAtrForSymbol = (symbol: string) => {
    if (!symbol) return;
    setIsFetchingAtr(true);
    setAtrPips(null);

    sendRequest("get_atr", { symbol })
      .then(data => {
        if (data?.atr_pips) {
          setAtrPips(parseFloat(data.atr_pips));
        } else {
          showStatus(`No ATR data for ${symbol}`, "warning");
        }
      })
      .catch(err => {
        console.error(`Failed to fetch ATR for ${symbol}:`, err);
        showStatus(`Failed to calculate ATR`, "danger");
      })
      .finally(() => {
        setIsFetchingAtr(false);
      });
  };

  // Trigger WS connection on mount
  useEffect(() => {
    setIsMounted(true);
    connectWS();
    return () => {
      if (wsRef.current) wsRef.current.close();
      if (messageTimeoutRef.current) clearTimeout(messageTimeoutRef.current);
    };
  }, []);

  // Re-fetch ATR when the selected symbol changes
  useEffect(() => {
    if (selectedSymbol && wsStatus === "connected") {
      fetchAtrForSymbol(selectedSymbol);
    } else {
      setAtrPips(null);
    }
  }, [selectedSymbol, wsStatus]);

  // Execute buy or sell scaled trade
  const handleTradeAction = async (direction: "buy" | "sell") => {
    if (!selectedSymbol) return showStatus("Select an instrument first", "warning");
    if (atrPips === null || atrPips <= 0) return showStatus("Wait for ATR to resolve", "warning");

    setIsSubmitting(true);
    const calculatedSl = parseFloat(atrPips.toFixed(2));

    showStatus(`Placing scaled-risk ${direction.toUpperCase()}...`, "info", 1500);

    try {
      const res = await sendRequest("trade", {
        symbol: selectedSymbol,
        direction: direction,
        ordertype: "market",
        qty: 0, // 0 triggers dynamic balance & risk-based calculation in copier
        sl_pips: calculatedSl
      });
      showStatus(res?.message || "Order scaled and executed!", "success");
    } catch (err: any) {
      showStatus(err || "Order placement failed", "danger");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Flatten selected symbol
  const handleFlattenAction = async () => {
    if (!selectedSymbol) return showStatus("Select an instrument first", "warning");
    setIsSubmitting(true);
    showStatus(`Flattening all ${selectedSymbol} positions...`, "warning", 2000);

    try {
      const res = await sendRequest("flatten", { instrument: selectedSymbol });
      showStatus(res?.message || `Flattened all ${selectedSymbol}!`, "success");
    } catch (err: any) {
      showStatus(err || "Flatten request failed", "danger");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Listen to native events directly on DOM elements. This guarantees React state propagates
  // correctly even after the DOM elements are physically re-parented into a Picture-in-Picture window.
  useEffect(() => {
    const selectEl = selectRef.current;
    const buyEl = buyBtnRef.current;
    const sellEl = sellBtnRef.current;
    const flattenEl = flattenBtnRef.current;

    const handleSelectChange = (e: Event) => {
      const target = e.target as HTMLSelectElement;
      setSelectedSymbol(target.value);
    };

    const handleBuyClick = () => {
      handleTradeAction("buy");
    };

    const handleSellClick = () => {
      handleTradeAction("sell");
    };

    const handleFlattenClick = () => {
      handleFlattenAction();
    };

    if (selectEl) selectEl.addEventListener("change", handleSelectChange);
    if (buyEl) buyEl.addEventListener("click", handleBuyClick);
    if (sellEl) sellEl.addEventListener("click", handleSellClick);
    if (flattenEl) flattenEl.addEventListener("click", handleFlattenClick);

    return () => {
      if (selectEl) selectEl.removeEventListener("change", handleSelectChange);
      if (buyEl) buyEl.removeEventListener("click", handleBuyClick);
      if (sellEl) sellEl.removeEventListener("click", handleSellClick);
      if (flattenEl) flattenEl.removeEventListener("click", handleFlattenClick);
    };
  }, [symbols, selectedSymbol, wsStatus, isSubmitting, atrPips]);

  // Document Picture-in-Picture Pop-out
  const popOutPanel = async () => {
    if (typeof window === "undefined" || !("documentPictureInPicture" in window)) {
      showStatus("Your browser does not support Picture-in-Picture windows.", "warning");
      return;
    }

    try {
      // @ts-ignore
      const pipWin = await window.documentPictureInPicture.requestWindow({
        width: 440,
        height: 135
      });

      // Copy styles from parent document using standard for loops to prevent ES target iteration errors
      for (let i = 0; i < document.styleSheets.length; i++) {
        const styleSheet = document.styleSheets[i];
        try {
          let cssRulesText = "";
          for (let j = 0; j < styleSheet.cssRules.length; j++) {
            cssRulesText += styleSheet.cssRules[j].cssText;
          }
          const style = pipWin.document.createElement("style");
          style.textContent = cssRulesText;
          pipWin.document.head.appendChild(style);
        } catch (e) {
          if (styleSheet.href) {
            const link = pipWin.document.createElement("link");
            link.rel = "stylesheet";
            link.href = styleSheet.href;
            pipWin.document.head.appendChild(link);
          }
        }
      }

      // Move the widget contents to the Pip window
      const container = pipWin.document.createElement("div");
      container.id = "micro-panel-root";
      pipWin.document.body.appendChild(container);
      pipWin.document.body.style.margin = "0";
      pipWin.document.body.style.overflow = "hidden";
      pipWin.document.body.style.backgroundColor = "#FAFAFA";

      // Render micro panel UI elements inside PiP container
      const parentRoot = document.getElementById("micro-widget-container");
      if (parentRoot) {
        container.appendChild(parentRoot);
      }

      // Restore it to standard window on PiP close
      pipWin.addEventListener("pagehide", () => {
        const backToParent = document.getElementById("parent-widget-host");
        if (backToParent && parentRoot) {
          backToParent.appendChild(parentRoot);
        }
      });

      showStatus("Floating PiP Window Opened!", "success");
    } catch (err) {
      console.error("Failed to open PiP window:", err);
      showStatus("Pop-out failed", "danger");
    }
  };

  const formatPnlWithPerc = (val: number | null, balance: number | null) => {
    if (val === null || isNaN(val)) return '0.00% (0.00$)';
    const percent = (balance && balance > 0) ? (val / balance) * 100 : 0;
    const sign = val > 0 ? '+' : '';
    const pSign = percent > 0 ? '+' : '';
    return `%${pSign}${percent.toFixed(2)} (${sign}${val.toFixed(2)}$)`;
  };

  const formattedPnL = totalPnL !== null ? formatPnlWithPerc(totalPnL, cashValue) : "0.00% (0.00$)";
  const pnlClass = totalPnL !== null && totalPnL > 0 
    ? "text-emerald-600 bg-emerald-50 border-emerald-200" 
    : totalPnL !== null && totalPnL < 0 
    ? "text-rose-600 bg-rose-50 border-rose-250" 
    : "text-neutral-500 bg-neutral-50 border-neutral-200";

  return (
    <div className="w-full min-h-screen bg-[#FAFAFA] p-2 text-neutral-900 antialiased select-none flex items-start justify-center">
      <div id="parent-widget-host" className="w-full max-w-[430px]">
        {/* Render actual widget */}
        <div 
          id="micro-widget-container"
          className="w-full p-3 transition-all duration-300 border rounded-2xl bg-white border-neutral-200/80 shadow-[0_4px_20px_rgba(0,0,0,0.03),0_1px_3px_rgba(0,0,0,0.02)]"
        >
          {/* Header row */}
          <div className="flex items-center justify-between gap-3 mb-2 flex-nowrap">
            {/* Status & Symbol */}
            <div className="flex items-center gap-2 flex-shrink-0">
              <div 
                className={`w-2 h-2 rounded-full transition-all duration-300 ${
                  wsStatus === "connected" 
                    ? "bg-emerald-500 shadow-sm shadow-emerald-500/30" 
                    : wsStatus === "connecting" 
                    ? "bg-amber-500 animate-pulse shadow-sm shadow-amber-500/30" 
                    : "bg-neutral-300"
                }`}
                title={`Status: ${wsStatus}`}
              />
              <div className="relative flex items-center">
                <select
                  ref={selectRef}
                  value={selectedSymbol}
                  disabled={wsStatus !== "connected" || isSubmitting}
                  className="pl-2 pr-8 py-1 text-xs font-semibold tracking-wide uppercase transition-all duration-200 border rounded-lg bg-neutral-50 border-neutral-200 text-neutral-800 hover:bg-neutral-100 hover:border-neutral-300 focus:outline-none focus:ring-0 appearance-none cursor-pointer"
                >
                  <option value="">---</option>
                  {symbols.map((sym) => (
                    <option key={sym} value={sym}>
                      {sym}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2.5 w-3.5 h-3.5 text-neutral-400 pointer-events-none" />
              </div>
            </div>

            {/* SL display based on ATR + spread */}
            <div className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-mono font-medium rounded-lg bg-neutral-50 border border-neutral-100 text-neutral-500">
              <span className="text-[10px] text-neutral-400 uppercase tracking-wider">SL:</span>
              {isFetchingAtr ? (
                <span className="w-10 h-3.5 bg-neutral-150 rounded animate-pulse" />
              ) : atrPips !== null ? (
                <span className="font-bold text-neutral-700">
                  {atrPips.toFixed(2)} <span className="text-[9px] text-neutral-400 font-normal">pips</span>
                </span>
              ) : (
                <span className="text-neutral-400">N/A</span>
              )}
            </div>

            {/* PNL Badge */}
            <div 
              className={`flex items-center gap-1 px-2 py-0.5 font-mono text-[10.5px] font-bold border rounded-lg whitespace-nowrap transition-all duration-300 ${pnlClass} ${
                pnlPulse === "up" ? "scale-105 shadow-md shadow-emerald-500/10" : pnlPulse === "down" ? "scale-95 shadow-md shadow-rose-500/10" : ""
              }`}
            >
              <Activity className="w-3 h-3 flex-shrink-0" />
              <span>{formattedPnL}</span>
            </div>
          </div>

          {/* Action Row */}
          <div className="grid grid-cols-7 gap-1.5 mb-1.5">
            {/* BUY */}
            <button
              ref={buyBtnRef}
              disabled={wsStatus !== "connected" || isSubmitting || atrPips === null}
              className="col-span-3 flex items-center justify-center gap-1.5 py-2 px-3 font-semibold text-xs rounded-xl text-white bg-emerald-600 hover:bg-emerald-500 active:scale-95 disabled:opacity-30 disabled:pointer-events-none transition-all duration-150 shadow-sm"
            >
              <TrendingUp className="w-4 h-4" />
              <span>BUY MARKET</span>
            </button>

            {/* SELL */}
            <button
              ref={sellBtnRef}
              disabled={wsStatus !== "connected" || isSubmitting || atrPips === null}
              className="col-span-3 flex items-center justify-center gap-1.5 py-2 px-3 font-semibold text-xs rounded-xl text-white bg-rose-600 hover:bg-rose-500 active:scale-95 disabled:opacity-30 disabled:pointer-events-none transition-all duration-150 shadow-sm"
            >
              <TrendingDown className="w-4 h-4" />
              <span>SELL MARKET</span>
            </button>

            {/* FLATTEN / CLOSE */}
            <button
              ref={flattenBtnRef}
              disabled={wsStatus !== "connected" || isSubmitting}
              className="col-span-1 flex items-center justify-center py-2 px-2 font-semibold rounded-xl bg-neutral-100 border border-neutral-200 text-neutral-700 hover:bg-neutral-200 hover:text-neutral-800 active:scale-95 disabled:opacity-30 disabled:pointer-events-none transition-all duration-150"
              title="Close selected symbol positions"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Status Message Strip */}
          <div className="flex items-center justify-between gap-2 px-1 text-[10px] text-neutral-400 font-mono tracking-tight font-medium flex-nowrap">
            <div className="truncate flex-grow">
              {message.text ? (
                <span className={`flex items-center gap-1 font-semibold ${
                  message.type === "success" 
                    ? "text-emerald-600" 
                    : message.type === "danger" 
                    ? "text-rose-600" 
                    : message.type === "warning" 
                    ? "text-amber-600" 
                    : "text-neutral-500"
                }`}>
                  <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                  <span className="truncate">{message.text}</span>
                </span>
              ) : (
                <span className="text-neutral-400">Ready to trade</span>
              )}
            </div>
            {isMounted && "documentPictureInPicture" in window && (
              <button 
                onClick={popOutPanel}
                className="flex items-center gap-0.5 py-0.5 px-1.5 rounded bg-white border border-neutral-250 hover:border-neutral-300 hover:bg-neutral-50 text-neutral-500 hover:text-neutral-700 transition-all font-mono"
              >
                <span>POP OUT</span>
                <ExternalLink className="w-2.5 h-2.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
