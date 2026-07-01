"use client";

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Activity, 
  ArrowDownRight, 
  ArrowUpRight, 
  ChevronDown, 
  TrendingUp, 
  TrendingDown,
  RefreshCw, 
  X, 
  XOctagon,
  Sun,
  Moon,
  ExternalLink,
  AlertCircle
} from 'lucide-react';

// --- TS Interface Declarations ---
interface Position {
  symbol: string;
  displaySymbol?: string;
  direction: 'BUY' | 'SELL';
  quantity: number;
  avgPrice: number;
  pnl?: number;
}

interface Order {
  symbol: string;
  displaySymbol?: string;
  direction: 'BUY' | 'SELL';
  quantity: number;
  orderType: 'limit' | 'stop' | 'market';
  price: number;
}

interface Account {
  id: string;
  type?: string;
  displayName?: string;
  status: 'Connected' | 'Connecting' | 'Disconnected' | 'Error';
  error?: string | null;
  realizedPNL?: number;
  unrealizedPNL?: number;
  positions: Position[];
  orders: Order[];
  lastUpdated?: string;
  cash_value?: number;
  buying_power?: number;
}

const safeParseFloat = (val: any, defaultVal: number = 0): number => {
  if (val === undefined || val === null) return defaultVal;
  const str = String(val).replace(',', '.').trim();
  const parsed = parseFloat(str);
  return isNaN(parsed) ? defaultVal : parsed;
};

export default function CockpitPanel() {
  // Mounted state to bypass server hydration mismatches
  const [isMounted, setIsMounted] = useState<boolean>(false);

  // Theme State
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  // WebSocket Connection States
  const [wsStatus, setWsStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('disconnected');
  const [symbols, setSymbols] = useState<string[]>([]);
  const [defaultSlPips, setDefaultSlPips] = useState<Record<string, number>>({});
  const [referenceAccount, setReferenceAccount] = useState<Account | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string>('Never');

  // Cockpit States
  const [selectedSymbol, setSelectedSymbol] = useState<string>('');
  const [executionTab, setExecutionTab] = useState<'entry' | 'modify' | 'manage'>('entry');
  const [entryMode, setEntryMode] = useState<'pip_risk' | 'atr_risk' | 'pending'>('pip_risk');
  const [tpMultiplier, setTpMultiplier] = useState<number>(2.0);

  // Pip & %Risk Mode State
  const [slPips, setSlPips] = useState<string>('20.0');
  const [customRisk, setCustomRisk] = useState<string>('2.0');

  // ATR & %Risk Mode State
  const [atrMultiplier, setAtrMultiplier] = useState<string>('2.0');
  const [atrRiskPerc, setAtrRiskPerc] = useState<string>('2.0');
  const [atrInfo, setAtrInfo] = useState<{ atr_raw: number; atr_pips: number } | null>(null);
  const [atrLoading, setAtrLoading] = useState<boolean>(false);

  // Pending Limit Mode State
  const [entryOffsetBuy, setEntryOffsetBuy] = useState<string>('5.0');
  const [entryOffsetSell, setEntryOffsetSell] = useState<string>('5.0');
  const [limitSlPips, setLimitSlPips] = useState<string>('15.0');
  const [limitTpPips, setLimitTpPips] = useState<string>('30.0');
  const [limitSizingMode, setLimitSizingMode] = useState<'risk' | 'lots'>('risk');
  const [limitRiskPerc, setLimitRiskPerc] = useState<string>('2.0');
  const [limitLots, setLimitLots] = useState<string>('1.0');
  const [limitUseDefault, setLimitUseDefault] = useState<boolean>(true);
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);

  // Modify Order Mode State
  const [modifyOffsetBuy, setModifyOffsetBuy] = useState<string>('5.0');
  const [modifyOffsetSell, setModifyOffsetSell] = useState<string>('5.0');

  // Manage Position Mode State
  const [manageSlEntryPips, setManageSlEntryPips] = useState<string>('10.0');
  const [manageSlMidPips, setManageSlMidPips] = useState<string>('5.0');
  const [manageTpEntryPips, setManageTpEntryPips] = useState<string>('20.0');
  const [manageTpMidPips, setManageTpMidPips] = useState<string>('10.0');



  // Micro Pad States
  const [showMicroPanel, setShowMicroPanel] = useState<boolean>(false);
  const [microSymbol, setMicroSymbol] = useState<string>('');
  const [microAtrPips, setMicroAtrPips] = useState<number | null>(null);
  const [microIsFetchingAtr, setMicroIsFetchingAtr] = useState<boolean>(false);
  const [microSubmitting, setMicroSubmitting] = useState<boolean>(false);

  // Message / Status Strip
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'danger' | 'info' | 'warning' | null }>({ text: '', type: null });
  
  const wsRef = useRef<WebSocket | null>(null);
  const pendingRequests = useRef<Record<string, { resolve: (data: any) => void; reject: (err: any) => void; timeout: any }>>({});
  const selectedSymbolRef = useRef<string>("");
  const containerRef = useRef<HTMLDivElement>(null);
  const messageTimeoutRef = useRef<any>(null);
  const pipWindowRef = useRef<any>(null);
  const microSymbolRef = useRef<string>("");

  useEffect(() => {
    selectedSymbolRef.current = selectedSymbol;
  }, [selectedSymbol]);

  useEffect(() => {
    microSymbolRef.current = microSymbol;
  }, [microSymbol]);

  // Load and Persist Theme Settings
  useEffect(() => {
    const savedTheme = localStorage.getItem('propfirm-theme') as 'light' | 'dark';
    if (savedTheme === 'light' || savedTheme === 'dark') {
      setTheme(savedTheme);
    } else if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      setTheme('dark');
    }
  }, []);

  useEffect(() => {
    const root = window.document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem('propfirm-theme', theme);

    if (pipWindowRef.current) {
      pipWindowRef.current.document.body.style.backgroundColor = theme === 'dark' ? '#0A0A0A' : '#FAFAFA';
    }
  }, [theme]);

  // Helper to show logs on the status strip
  const showStatus = (text: string, type: 'success' | 'danger' | 'info' | 'warning', duration = 4000) => {
    if (messageTimeoutRef.current) clearTimeout(messageTimeoutRef.current);
    setMessage({ text, type });
    if (duration > 0) {
      messageTimeoutRef.current = setTimeout(() => {
        setMessage({ text: '', type: null });
      }, duration);
    }
  };

  // WebSocket Connection Core
  const connectWS = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;

    setWsStatus('connecting');
    const host = typeof window !== 'undefined' ? window.location.hostname : '127.0.0.1';
    const WS_URL = `ws://${host}:9999/ws`;

    try {
      const socket = new WebSocket(WS_URL);
      wsRef.current = socket;

      socket.onopen = () => {
        setWsStatus('connected');
        showStatus('Server Connected', 'success', 2000);

        // Fetch initial reference account state
        sendRequest('get_account_status')
          .then(data => {
            if (data?.account) {
              setReferenceAccount(data.account);
              setLastUpdated(new Date().toLocaleTimeString());
            }
          })
          .catch(err => console.error('Failed to fetch initial status:', err));

        // Fetch global symbols
        sendRequest('get_global_symbols')
          .then(data => {
            if (data?.symbols) {
              setSymbols(data.symbols);
              if (data.slpips) setDefaultSlPips(data.slpips);
              if (data.tp_multiplier !== undefined) setTpMultiplier(data.tp_multiplier);
            }
          })
          .catch(err => console.error('Failed to fetch symbols:', err));

        // Subscribe channels
        sendRequest('subscribe_account').catch(e => console.error('Sub error:', e));
        sendRequest('subscribe_logs').catch(e => console.error('Sub error:', e));
        sendRequest('subscribe_atr').catch(e => console.error('Sub error:', e));
      };

      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);

          // Handle response to explicit request Promises
          if (payload.requestId && pendingRequests.current[payload.requestId]) {
            const { resolve, reject, timeout } = pendingRequests.current[payload.requestId];
            clearTimeout(timeout);
            
            if (payload.status === 'ok') {
              resolve(payload.data);
            } else {
              reject(payload.error || 'Server error response');
            }
            delete pendingRequests.current[payload.requestId];
          } 
          // Handle pushed updates
          else if (payload.type) {
            switch (payload.type) {
              case 'account_update':
                if (payload.data?.account) {
                  setReferenceAccount(payload.data.account);
                  setLastUpdated(new Date().toLocaleTimeString());
                }
                break;
              case 'log_update':
                if (payload.data?.message) {
                  const msgText = payload.data.message;
                  const isErr = /error|fail|invalid/i.test(msgText);
                  const isSuccess = /success|executed|filled/i.test(msgText);
                  showStatus(
                    msgText, 
                    isErr ? 'danger' : isSuccess ? 'success' : 'info',
                    isErr ? 6000 : 3000
                  );
                }
                break;
              case 'atr_update':
                if (payload.data?.atr) {
                  const atrData = payload.data.atr;
                  const currentSymbol = selectedSymbolRef.current;
                  if (currentSymbol && atrData[currentSymbol]) {
                    setAtrInfo(atrData[currentSymbol]);
                  }
                  const currentMicroSymbol = microSymbolRef.current;
                  if (currentMicroSymbol && atrData[currentMicroSymbol]) {
                    setMicroAtrPips(parseFloat(atrData[currentMicroSymbol].atr_pips));
                  }
                }
                break;
            }
          }
        } catch (err) {
          console.error('Failed to parse WebSocket message:', err);
        }
      };

      socket.onerror = (e) => {
        console.error('WebSocket error:', e);
        setWsStatus('error');
        showStatus('Connection Error', 'danger', 0);
      };

      socket.onclose = () => {
        setWsStatus('disconnected');
        showStatus('Disconnected. Reconnecting...', 'warning', 0);
        
        // Clean up pending requests
        Object.values(pendingRequests.current).forEach((p: any) => p.reject('WebSocket Closed'));
        pendingRequests.current = {};

        // Auto reconnect
        setTimeout(connectWS, 5000);
      };
    } catch (err) {
      console.error('WebSocket exception:', err);
      setWsStatus('disconnected');
    }
  };

  // Promise Wrapper for sending WebSocket commands
  const sendRequest = (command: string, payload: any = {}): Promise<any> => {
    return new Promise((resolve, reject) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        return reject('Socket not connected');
      }

      const requestId = Math.random().toString(36).substring(2, 11);
      const msg = {
        receiver: 'proplink',
        data: {
          requestId,
          command,
          payload
        }
      };

      const timeout = setTimeout(() => {
        if (pendingRequests.current[requestId]) {
          pendingRequests.current[requestId].reject('Request Timeout');
          delete pendingRequests.current[requestId];
        }
      }, 10000);

      pendingRequests.current[requestId] = { resolve, reject, timeout };
      wsRef.current.send(JSON.stringify(msg));
    });
  };

  // Connect on Mount
  useEffect(() => {
    setIsMounted(true);
    connectWS();
    return () => {
      if (wsRef.current) wsRef.current.close();
      if (messageTimeoutRef.current) clearTimeout(messageTimeoutRef.current);
    };
  }, []);

  // Symbol Suffix Matcher & Derived Working States
  const matchSymbol = (brokerSymbol: string | undefined, displaySymbol: string | undefined, globalSymbol: string): boolean => {
    if (!globalSymbol) return false;
    if (displaySymbol === globalSymbol) return true;
    if (brokerSymbol === globalSymbol) return true;
    
    if (brokerSymbol) {
      const cleanBroker = brokerSymbol.split(/[.\-_]/)[0];
      if (cleanBroker === globalSymbol) return true;
      if (brokerSymbol.startsWith(globalSymbol)) return true;
    }
    return false;
  };

  const activePosition = useMemo(() => {
    if (!referenceAccount?.positions || !selectedSymbol) return null;
    return referenceAccount.positions.find((pos: Position) => matchSymbol(pos.symbol, pos.displaySymbol, selectedSymbol));
  }, [referenceAccount, selectedSymbol]);

  const pendingOrder = useMemo(() => {
    if (!referenceAccount?.orders || !selectedSymbol) return null;
    return referenceAccount.orders.find((ord: Order) => matchSymbol(ord.symbol, ord.displaySymbol, selectedSymbol));
  }, [referenceAccount, selectedSymbol]);

  const computedDefaultSl = useMemo(() => {
    if (!selectedSymbol) return 15.0;
    return atrInfo ? Math.round(atrInfo.atr_pips) : (defaultSlPips[selectedSymbol] || 15.0);
  }, [selectedSymbol, atrInfo, defaultSlPips]);

  const computedDefaultTp = useMemo(() => {
    return computedDefaultSl * tpMultiplier;
  }, [computedDefaultSl, tpMultiplier]);

  // Autofill Default SL/TP based on selectedSymbol
  useEffect(() => {
    if (selectedSymbol && defaultSlPips[selectedSymbol] !== undefined) {
      const slString = defaultSlPips[selectedSymbol].toString();
      setSlPips(slString);
      setLimitSlPips(slString);
      
      const slFloat = safeParseFloat(slString);
      setLimitTpPips((slFloat * tpMultiplier).toString());
      
      const isIndex = ['SP500', 'DAX40', 'FTSE100', 'NQ100', 'GOLD'].includes(selectedSymbol);
      if (isIndex) {
        setLimitSizingMode('lots');
      } else {
        setLimitSizingMode('risk');
      }
    }
  }, [selectedSymbol, defaultSlPips, tpMultiplier]);

  // Fetch ATR on selectedSymbol, entryMode or limitUseDefault changes
  useEffect(() => {
    if (selectedSymbol && (entryMode === 'atr_risk' || (entryMode === 'pending' && limitUseDefault)) && wsStatus === 'connected') {
      setAtrLoading(true);
      sendRequest('get_atr', { symbol: selectedSymbol })
        .then(res => {
          if (res?.atr_pips) {
            setAtrInfo({ atr_raw: parseFloat(res.atr_raw || 0), atr_pips: parseFloat(res.atr_pips) });
          } else if (res?.success && res.atr_pips) {
            setAtrInfo(res);
          } else {
            setAtrInfo(null);
          }
        })
        .catch(err => {
          setAtrInfo(null);
          console.error('ATR load error:', err);
        })
        .finally(() => setAtrLoading(false));
    }
  }, [selectedSymbol, entryMode, limitUseDefault, wsStatus]);

  // Fetch ATR for Micro Symbol on changes
  useEffect(() => {
    if (microSymbol && wsStatus === 'connected') {
      setMicroIsFetchingAtr(true);
      sendRequest('get_atr', { symbol: microSymbol })
        .then(res => {
          if (res?.atr_pips) {
            setMicroAtrPips(parseFloat(res.atr_pips));
          } else if (res?.success && res.atr_pips) {
            setMicroAtrPips(parseFloat(res.atr_pips));
          } else {
            setMicroAtrPips(null);
          }
        })
        .catch(() => setMicroAtrPips(null))
        .finally(() => setMicroIsFetchingAtr(false));
    } else {
      setMicroAtrPips(null);
    }
  }, [microSymbol, wsStatus]);

  const handleMicroTrade = async (direction: 'buy' | 'sell') => {
    if (!microSymbol) return showStatus('Select an instrument on Micro Pad first', 'warning');
    if (microAtrPips === null || microAtrPips <= 0) return showStatus('Wait for Micro ATR to resolve', 'warning');

    setMicroSubmitting(true);
    const calculatedSl = parseFloat(microAtrPips.toFixed(2));
    showStatus(`Placing scaled-risk ${direction.toUpperCase()} (Micro Pad)...`, 'info', 1500);

    try {
      const res = await sendRequest('trade', {
        symbol: microSymbol,
        direction: direction,
        ordertype: 'market',
        qty: 0,
        sl_pips: calculatedSl
      });
      showStatus(res?.message || 'Order executed (Micro Pad)!', 'success');
    } catch (err: any) {
      showStatus(err || 'Order failed (Micro Pad)', 'danger');
    } finally {
      setMicroSubmitting(false);
    }
  };

  const handleMicroFlatten = async () => {
    if (!microSymbol) return showStatus('Select an instrument on Micro Pad first', 'warning');
    setMicroSubmitting(true);
    showStatus(`Flattening all ${microSymbol} positions (Micro Pad)...`, 'warning', 2000);

    try {
      const res = await sendRequest('flatten', { instrument: microSymbol });
      showStatus(res?.message || `Flattened all ${microSymbol}!`, 'success');
    } catch (err: any) {
      showStatus(err || 'Flatten failed', 'danger');
    } finally {
      setMicroSubmitting(false);
    }
  };

  // Handlers for Execution
  const handleEntryTrade = (
    direction: 'buy' | 'sell',
    ordertype: string = 'market',
    slVal: number,
    tpVal: number = 0,
    offsetVal: number = 0,
    riskPerc: number = 0,
    lotsVal: number = 0
  ) => {
    if (!selectedSymbol) return showStatus('Select a symbol first!', 'warning');

    let finalSl = slVal;
    let finalTp = tpVal;
    let finalRisk = riskPerc;
    let finalLots = lotsVal;

    if (entryMode === 'pending' && limitUseDefault) {
      finalSl = atrInfo ? Math.round(atrInfo.atr_pips) : (defaultSlPips[selectedSymbol] || 15.0);
      finalTp = finalSl * tpMultiplier;
      finalRisk = 0;
      finalLots = 0;
    }

    if (isNaN(finalSl) || finalSl <= 0) return showStatus('Input a valid Stop Loss (pips)!', 'warning');

    const payload: any = {
      symbol: selectedSymbol,
      direction,
      ordertype,
      sl_pips: finalSl,
      tp_pips: finalTp,
      offset_pips: offsetVal,
    };

    if (finalRisk > 0) {
      payload.risk = finalRisk;
      payload.qty = 0.0;
    } else if (finalLots > 0) {
      payload.qty = finalLots;
      payload.risk = 0.0;
    } else {
      payload.qty = 0.0;
      payload.risk = 0.0;
    }

    const modeText = ordertype === 'market' ? 'MARKET' : `PENDING ${ordertype.toUpperCase()}`;
    showStatus(`Placing scaled ${modeText} ${direction.toUpperCase()}...`, 'info', 2000);

    sendRequest('trade', payload)
      .then(res => {
        showStatus(res?.message || 'Trade placed successfully.', 'success');
      })
      .catch(err => {
        showStatus(`Trade failed: ${err}`, 'danger');
      });
  };

  const handleModifyOrder = (newPriceType: string) => {
    if (!selectedSymbol) return showStatus('Select a symbol first!', 'warning');
    
    let offsetVal = 0;
    if (newPriceType === 'offset' && pendingOrder) {
      const isBuy = pendingOrder.direction === 'BUY';
      offsetVal = safeParseFloat(isBuy ? modifyOffsetBuy : modifyOffsetSell);
      if (isNaN(offsetVal) || offsetVal < 0) {
        return showStatus('Please input a valid offset value!', 'warning');
      }
    }

    const payload = {
      symbol: selectedSymbol,
      new_price_type: newPriceType,
      offset_pips: offsetVal
    };

    showStatus(`Modifying pending order to ${newPriceType.toUpperCase()}...`, 'info', 2000);

    sendRequest('modify_order', payload)
      .then(res => {
        showStatus(res?.message || 'Order modified successfully.', 'success');
      })
      .catch(err => {
        showStatus(`Modification failed: ${err}`, 'danger');
      });
  };

  const handleCancelSelectedOrder = () => {
    if (!selectedSymbol) return showStatus('Select a symbol first!', 'warning');
    showStatus(`Cancelling pending order for ${selectedSymbol}...`, 'info');
    sendRequest('cancel_order', { symbol: selectedSymbol })
      .then(res => showStatus(res?.message || 'Order cancelled successfully.', 'success'))
      .catch(err => showStatus(`Cancellation failed: ${err}`, 'danger'));
  };

  const handleFlattenPosition = () => {
    if (!selectedSymbol) return showStatus('Select a symbol first!', 'warning');
    showStatus(`Flattening ${selectedSymbol} positions...`, 'info');
    sendRequest('flatten', { instrument: selectedSymbol })
      .then(res => showStatus(res?.message || 'Positions closed successfully.', 'success'))
      .catch(err => showStatus(`Flatten failed: ${err}`, 'danger'));
  };

  const handleManagePosition = (type: 'breakeven' | 'sl_entry' | 'sl_mid' | 'tp_entry' | 'tp_mid') => {
    if (!selectedSymbol) return showStatus('Select a symbol first!', 'warning');

    const payload: any = {
      symbol: selectedSymbol
    };

    if (type === 'breakeven') {
      payload.sl = { type: 'breakeven' };
    } else if (type === 'sl_entry') {
      const slVal = safeParseFloat(manageSlEntryPips);
      if (isNaN(slVal) || slVal < 0) return showStatus('Invalid SL pips value', 'warning');
      payload.sl = { type: 'pips_from_entry', value: slVal };
    } else if (type === 'sl_mid') {
      const slVal = safeParseFloat(manageSlMidPips);
      if (isNaN(slVal) || slVal < 0) return showStatus('Invalid SL pips value', 'warning');
      payload.sl = { type: 'pips_from_mid', value: slVal };
    } else if (type === 'tp_entry') {
      const tpVal = safeParseFloat(manageTpEntryPips);
      if (isNaN(tpVal) || tpVal < 0) return showStatus('Invalid TP pips value', 'warning');
      payload.tp = { type: 'pips_from_entry', value: tpVal };
    } else if (type === 'tp_mid') {
      const tpVal = safeParseFloat(manageTpMidPips);
      if (isNaN(tpVal) || tpVal < 0) return showStatus('Invalid TP pips value', 'warning');
      payload.tp = { type: 'pips_from_mid', value: tpVal };
    }

    showStatus(`Updating position stops for ${selectedSymbol}...`, 'info');

    sendRequest('manage_position_stops', payload)
      .then(res => {
        showStatus(res?.message || 'Position stops updated successfully.', 'success');
      })
      .catch(err => {
        showStatus(`Failed to update position stops: ${err}`, 'danger');
      });
  };

  const handleManualRefresh = () => {
    showStatus('Refreshing cockpit data...', 'info', 1500);
    sendRequest('get_account_status')
      .then(d => {
        if (d?.account) setReferenceAccount(d.account);
      })
      .catch(e => showStatus(`Refresh failed: ${e}`, 'warning'));
  };

  // Native input & click delegates to support Document Picture-in-Picture window updates
  const handleNativeInput = (field: string, value: string) => {
    switch (field) {
      case 'selectedSymbol':
        setSelectedSymbol(value);
        break;
      case 'microSymbol':
        setMicroSymbol(value);
        break;
      case 'slPips':
        setSlPips(value);
        break;
      case 'customRisk':
        setCustomRisk(value);
        break;
      case 'atrMultiplier':
        setAtrMultiplier(value);
        break;
      case 'atrRiskPerc':
        setAtrRiskPerc(value);
        break;
      case 'entryOffsetBuy':
        setEntryOffsetBuy(value);
        break;
      case 'entryOffsetSell':
        setEntryOffsetSell(value);
        break;
      case 'limitSlPips':
        setLimitSlPips(value);
        const v = parseFloat(value);
        if (!isNaN(v)) {
          setLimitTpPips((v * tpMultiplier).toString());
        }
        break;
      case 'limitTpPips':
        setLimitTpPips(value);
        break;
      case 'limitRiskPerc':
        setLimitRiskPerc(value);
        break;
      case 'limitLots':
        setLimitLots(value);
        break;
      case 'modifyOffsetBuy':
        setModifyOffsetBuy(value);
        break;
      case 'modifyOffsetSell':
        setModifyOffsetSell(value);
        break;
      case 'manageSlEntryPips':
        setManageSlEntryPips(value);
        break;
      case 'manageSlMidPips':
        setManageSlMidPips(value);
        break;
      case 'manageTpEntryPips':
        setManageTpEntryPips(value);
        break;
      case 'manageTpMidPips':
        setManageTpMidPips(value);
        break;
    }
  };

  const handleNativeClick = (action: string, value: string | null) => {
    switch (action) {
      case 'toggle-limit-use-default':
        setLimitUseDefault(prev => !prev);
        break;
      case 'toggle-dropdown':
        if (value) {
          setActiveDropdown(prev => prev === value ? null : value);
        }
        break;
      case 'select-preset':
        if (value) {
          const parts = value.split(':');
          const field = parts[0];
          const val = parts[1];
          if (field && val) {
            handleNativeInput(field, val);
          }
          setActiveDropdown(null);
        }
        break;
      case 'change-tab':
        if (value) setExecutionTab(value as any);
        break;
      case 'change-entry-mode':
        if (value) setEntryMode(value as any);
        break;
      case 'change-sizing-mode':
        if (value) setLimitSizingMode(value as any);
        break;
      case 'buy-market':
        if (entryMode === 'pip_risk') {
          handleEntryTrade('buy', 'market', safeParseFloat(slPips), 0, 0, safeParseFloat(customRisk));
        } else if (entryMode === 'atr_risk') {
          if (!atrInfo) return showStatus('Wait for ATR calculation', 'warning');
          const calculated_atr_sl = parseFloat((atrInfo.atr_pips * safeParseFloat(atrMultiplier)).toFixed(2));
          handleEntryTrade('buy', 'market', calculated_atr_sl, 0, 0, safeParseFloat(atrRiskPerc));
        }
        break;
      case 'sell-market':
        if (entryMode === 'pip_risk') {
          handleEntryTrade('sell', 'market', safeParseFloat(slPips), 0, 0, safeParseFloat(customRisk));
        } else if (entryMode === 'atr_risk') {
          if (!atrInfo) return showStatus('Wait for ATR calculation', 'warning');
          const calculated_atr_sl = parseFloat((atrInfo.atr_pips * safeParseFloat(atrMultiplier)).toFixed(2));
          handleEntryTrade('sell', 'market', calculated_atr_sl, 0, 0, safeParseFloat(atrRiskPerc));
        }
        break;
      case 'execute-trade':
        if (value) {
          const parts = value.split('_');
          const direction = parts[0] as 'buy' | 'sell';
          const ordertype = parts.slice(1).join('_');
          
          let offsetVal = 0;
          if (ordertype === 'offset_buy') {
            offsetVal = safeParseFloat(entryOffsetBuy);
          } else if (ordertype === 'offset_sell') {
            offsetVal = safeParseFloat(entryOffsetSell);
          }

          const slVal = safeParseFloat(limitSlPips);
          const tpVal = safeParseFloat(limitTpPips);
          const riskVal = limitSizingMode === 'risk' ? safeParseFloat(limitRiskPerc) : 0;
          const lotsVal = limitSizingMode === 'lots' ? safeParseFloat(limitLots) : 0;

          handleEntryTrade(direction, ordertype, slVal, tpVal, offsetVal, riskVal, lotsVal);
        }
        break;
      case 'modify-order':
        if (value) handleModifyOrder(value);
        break;
      case 'cancel-order':
        handleCancelSelectedOrder();
        break;
      case 'flatten-position':
        handleFlattenPosition();
        break;
      case 'position-breakeven':
        handleManagePosition('breakeven');
        break;
      case 'position-sl-entry':
        handleManagePosition('sl_entry');
        break;
      case 'position-sl-mid':
        handleManagePosition('sl_mid');
        break;
      case 'position-tp-entry':
        handleManagePosition('tp_entry');
        break;
      case 'position-tp-mid':
        handleManagePosition('tp_mid');
        break;
      case 'toggle-theme':
        setTheme((prev: 'light' | 'dark') => prev === 'dark' ? 'light' : 'dark');
        break;
      case 'pop-out':
        popOutPanel();
        break;
      case 'close-alert':
        setMessage({ text: '', type: null });
        break;
      case 'manual-refresh':
        handleManualRefresh();
        break;
      case 'change-symbol':
        if (value) setSelectedSymbol(value);
        break;
      case 'toggle-micro': {
        const nextVal = !showMicroPanel;
        if (pipWindowRef.current) {
          try {
            pipWindowRef.current.resizeTo(440, nextVal ? 710 : 570);
          } catch (err) {
            console.error("Failed to resize PiP window:", err);
          }
        }
        setShowMicroPanel(nextVal);
        break;
      }
      case 'micro-buy':
        handleMicroTrade('buy');
        break;
      case 'micro-sell':
        handleMicroTrade('sell');
        break;
      case 'micro-flatten':
        handleMicroFlatten();
        break;
    }
  };

  const handleNativeClickRef = useRef(handleNativeClick);
  const handleNativeInputRef = useRef(handleNativeInput);

  useEffect(() => {
    handleNativeClickRef.current = handleNativeClick;
    handleNativeInputRef.current = handleNativeInput;
  });

  // Attach native handlers directly to intercept events inside Document Picture-in-Picture window
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const actionBtn = target.closest('[data-action]');
      if (actionBtn) {
        const action = actionBtn.getAttribute('data-action');
        const val = actionBtn.getAttribute('data-value');
        if (action) handleNativeClickRef.current(action, val);
      } else {
        setActiveDropdown(null);
      }
    };

    const handleInput = (e: Event) => {
      const target = e.target as HTMLInputElement | HTMLSelectElement;
      const field = target.getAttribute('data-field');
      if (field) {
        handleNativeInputRef.current(field, target.value);
      }
    };

    container.addEventListener('click', handleClick);
    container.addEventListener('input', handleInput);
    container.addEventListener('change', handleInput);

    return () => {
      container.removeEventListener('click', handleClick);
      container.removeEventListener('input', handleInput);
      container.removeEventListener('change', handleInput);
    };
  }, [isMounted]);

  // Picture-in-Picture window pop-out logic
  const popOutPanel = async () => {
    if (typeof window === 'undefined' || !('documentPictureInPicture' in window)) {
      showStatus('Picture-in-Picture is not supported in this browser.', 'warning');
      return;
    }

    try {
      // @ts-ignore
      const pipWin = await window.documentPictureInPicture.requestWindow({
        width: 440,
        height: showMicroPanel ? 710 : 570
      });

      pipWindowRef.current = pipWin;

      // Copy stylesheets
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

      // Reparent the panel container to the PiP window body
      const rootDiv = pipWin.document.createElement('div');
      rootDiv.id = 'cockpit-panel-root';
      pipWin.document.body.appendChild(rootDiv);
      pipWin.document.body.style.margin = '0';
      pipWin.document.body.style.overflow = 'hidden';
      pipWin.document.body.style.backgroundColor = theme === 'dark' ? '#0A0A0A' : '#FAFAFA';

      const widget = document.getElementById('cockpit-widget-container');
      if (widget) {
        rootDiv.appendChild(widget);
      }

      // Restore panel on PiP close
      pipWin.addEventListener('pagehide', () => {
        pipWindowRef.current = null;
        const host = document.getElementById('parent-widget-host');
        const widgetToMove = pipWin.document.getElementById('cockpit-widget-container');
        if (host && widgetToMove) {
          host.appendChild(widgetToMove);
        }
      });

      showStatus('Cockpit Pop-out Active!', 'success');
    } catch (err) {
      console.error('Failed to open PiP window:', err);
      showStatus('Popout failed to initialize', 'danger');
    }
  };

  const formatPnlWithPerc = (val: number | undefined, balance: number | undefined) => {
    if (val === undefined || isNaN(val)) return '0.00% (0.00$)';
    const percent = (balance && balance > 0) ? (val / balance) * 100 : 0;
    const sign = val > 0 ? '+' : '';
    const pSign = percent > 0 ? '+' : '';
    return `%${pSign}${percent.toFixed(2)} (${sign}${val.toFixed(2)}$)`;
  };

  const formattedPnL = referenceAccount?.unrealizedPNL !== undefined
    ? formatPnlWithPerc(referenceAccount.unrealizedPNL, referenceAccount.cash_value)
    : '0.00% (0.00$)';

  const pnlClass = referenceAccount?.unrealizedPNL !== undefined && referenceAccount.unrealizedPNL > 0
    ? 'text-emerald-600 bg-emerald-50 border-emerald-200 dark:text-emerald-400 dark:bg-emerald-950/40 dark:border-emerald-900/40'
    : referenceAccount?.unrealizedPNL !== undefined && referenceAccount.unrealizedPNL < 0
    ? 'text-rose-600 bg-rose-50 border-rose-200 dark:text-rose-400 dark:bg-rose-950/40 dark:border-rose-900/40'
    : 'text-neutral-500 bg-neutral-50 border-neutral-200 dark:text-neutral-400 dark:bg-neutral-900/40 dark:border-neutral-800/40';

  if (!isMounted) {
    return <div className="w-full min-h-screen bg-[#FAFAFA] dark:bg-[#0A0A0A]" />;
  }

  return (
    <div className={`w-full min-h-screen p-3 text-neutral-900 antialiased select-none flex items-start justify-center transition-colors duration-200 ${
      theme === 'dark' ? 'bg-[#0A0A0A]' : 'bg-[#FAFAFA]'
    }`}>
      <div id="parent-widget-host" className="w-full max-w-[440px]">
        
        {/* Render Execution Cockpit Panel */}
        <div 
          ref={containerRef}
          id="cockpit-widget-container"
          className={`w-full p-4 transition-all duration-300 border rounded-2xl shadow-[0_4px_20px_rgba(0,0,0,0.03),0_1px_3px_rgba(0,0,0,0.02)] ${
            theme === 'dark' 
              ? 'bg-[#121212] border-neutral-800 text-neutral-100' 
              : 'bg-white border-neutral-200/80 text-neutral-900'
          }`}
        >
          
          {/* Header Row */}
          <div className="flex items-center justify-between gap-2.5 mb-3 flex-nowrap">
            {/* Status dot and Symbol Selector */}
            <div className="flex items-center gap-2 flex-shrink-0">
              <div 
                className={`w-2 h-2 rounded-full transition-all duration-300 ${
                  wsStatus === 'connected' 
                    ? 'bg-emerald-500 shadow-sm shadow-emerald-500/30' 
                    : wsStatus === 'connecting' 
                    ? 'bg-amber-500 animate-pulse shadow-sm shadow-amber-500/30' 
                    : 'bg-rose-500'
                }`}
                title={`Status: ${wsStatus}`}
              />
              <div className="relative flex items-center">
                <select
                  data-field="selectedSymbol"
                  value={selectedSymbol}
                  onChange={(e) => setSelectedSymbol(e.target.value)}
                  disabled={wsStatus !== 'connected'}
                  className={`pl-2 pr-8 py-1.5 text-xs font-semibold tracking-wide uppercase transition-all duration-200 border rounded-lg appearance-none cursor-pointer focus:outline-none ${
                    theme === 'dark'
                      ? 'bg-neutral-900 border-neutral-800 text-neutral-200 hover:bg-neutral-850 hover:border-neutral-750'
                      : 'bg-neutral-50 border-neutral-200 text-neutral-800 hover:bg-neutral-100 hover:border-neutral-300'
                  }`}
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

            {/* PNL Badge */}
            <div className={`flex items-center gap-1.5 px-2.5 py-1 font-mono text-[10.5px] font-bold border rounded-lg whitespace-nowrap transition-all ${pnlClass}`}>
              <Activity className="w-3.5 h-3.5 flex-shrink-0" />
              <span>{formattedPnL}</span>
            </div>
          </div>

          {/* Execution Cockpit Main Header & Tabs */}
          <div className="flex flex-col gap-3.5 mb-3">
            {/* Pill Tabs */}
            <div className={`grid grid-cols-3 p-1 rounded-lg border transition-all ${
              theme === 'dark' ? 'bg-neutral-950/80 border-neutral-900' : 'bg-neutral-150 border-neutral-200'
            }`}>
              <button
                data-action="change-tab"
                data-value="entry"
                className={`py-1.5 rounded-md font-bold text-[10.5px] uppercase tracking-wider transition-all ${
                  executionTab === 'entry'
                    ? (theme === 'dark' ? 'bg-neutral-850 text-white shadow-sm' : 'bg-white text-neutral-900 shadow-sm')
                    : 'text-neutral-500 hover:text-neutral-350 dark:hover:text-neutral-300'
                }`}
              >
                Entry
              </button>

              <button
                data-action="change-tab"
                data-value="modify"
                className={`py-1.5 rounded-md font-bold text-[10.5px] uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 relative ${
                  executionTab === 'modify'
                    ? (theme === 'dark' ? 'bg-neutral-850 text-white shadow-sm' : 'bg-white text-neutral-900 shadow-sm')
                    : 'text-neutral-500 hover:text-neutral-350 dark:hover:text-neutral-300'
                }`}
              >
                Modify
                {pendingOrder && (
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-amber-500"></span>
                  </span>
                )}
              </button>

              <button
                data-action="change-tab"
                data-value="manage"
                className={`py-1.5 rounded-md font-bold text-[10.5px] uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 relative ${
                  executionTab === 'manage'
                    ? (theme === 'dark' ? 'bg-neutral-850 text-white shadow-sm' : 'bg-white text-neutral-900 shadow-sm')
                    : 'text-neutral-500 hover:text-neutral-350 dark:hover:text-neutral-300'
                }`}
              >
                Manage
                {activePosition && (
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* TAB 1: ENTRY */}
          {executionTab === 'entry' && (
            <div className="flex flex-col gap-3">
              {/* Sizing Mode Selection sub-tabs */}
              <div className={`grid grid-cols-3 gap-1 p-0.5 rounded-lg border transition-all ${
                theme === 'dark' ? 'bg-neutral-950/40 border-neutral-900' : 'bg-neutral-100/50 border-neutral-200'
              }`}>
                <button
                  data-action="change-entry-mode"
                  data-value="pip_risk"
                  className={`py-1 rounded-md text-[9.5px] font-bold uppercase transition-all ${
                    entryMode === 'pip_risk'
                      ? (theme === 'dark' ? 'bg-neutral-800 text-white shadow-sm' : 'bg-white text-neutral-900 shadow-sm')
                      : 'text-neutral-500 hover:text-neutral-350'
                  }`}
                >
                  Pip Risk
                </button>
                <button
                  data-action="change-entry-mode"
                  data-value="atr_risk"
                  className={`py-1 rounded-md text-[9.5px] font-bold uppercase transition-all ${
                    entryMode === 'atr_risk'
                      ? (theme === 'dark' ? 'bg-neutral-800 text-white shadow-sm' : 'bg-white text-neutral-900 shadow-sm')
                      : 'text-neutral-500 hover:text-neutral-350'
                  }`}
                >
                  ATR Risk
                </button>
                <button
                  data-action="change-entry-mode"
                  data-value="pending"
                  className={`py-1 rounded-md text-[9.5px] font-bold uppercase transition-all ${
                    entryMode === 'pending'
                      ? (theme === 'dark' ? 'bg-neutral-800 text-white shadow-sm' : 'bg-white text-neutral-900 shadow-sm')
                      : 'text-neutral-500 hover:text-neutral-350'
                  }`}
                >
                  Pending
                </button>
              </div>

              {/* Pip & %Risk Inputs */}
              {entryMode === 'pip_risk' && (
                <div className="flex flex-col gap-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1">
                      <label className={`text-[10px] px-1 font-bold ${theme === 'dark' ? 'text-neutral-500' : 'text-neutral-450'}`}>SL Pips</label>
                      <input
                        type="number"
                        data-field="slPips"
                        value={slPips}
                        onChange={(e) => setSlPips(e.target.value)}
                        placeholder="SL pips"
                        className={`w-full border rounded-lg px-3 py-2 text-xs font-mono transition-all font-semibold focus:outline-none ${
                          theme === 'dark'
                            ? 'bg-neutral-900/85 border-neutral-800 text-neutral-200 focus:border-neutral-600'
                            : 'bg-white border-neutral-200 text-neutral-800 focus:border-neutral-400'
                        }`}
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className={`text-[10px] px-1 font-bold ${theme === 'dark' ? 'text-neutral-500' : 'text-neutral-450'}`}>Risk %</label>
                      <input
                        type="number"
                        step="0.1"
                        data-field="customRisk"
                        value={customRisk}
                        onChange={(e) => setCustomRisk(e.target.value)}
                        placeholder="Risk %"
                        className={`w-full border rounded-lg px-3 py-2 text-xs font-mono transition-all font-semibold focus:outline-none ${
                          theme === 'dark'
                            ? 'bg-neutral-900/85 border-neutral-800 text-neutral-200 focus:border-neutral-600'
                            : 'bg-white border-neutral-200 text-neutral-800 focus:border-neutral-400'
                        }`}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 mt-1">
                    <button
                      data-action="buy-market"
                      className="py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs tracking-wide active:scale-95 transition-all flex items-center justify-center gap-1.5 shadow-sm"
                    >
                      <ArrowUpRight size={14} />
                      BUY MKT
                    </button>
                    <button
                      data-action="sell-market"
                      className="py-2.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs tracking-wide active:scale-95 transition-all flex items-center justify-center gap-1.5 shadow-sm"
                    >
                      <ArrowDownRight size={14} />
                      SELL MKT
                    </button>
                  </div>
                </div>
              )}

              {/* ATR & %Risk Inputs */}
              {entryMode === 'atr_risk' && (
                <div className="flex flex-col gap-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1">
                      <label className={`text-[10px] px-1 font-bold ${theme === 'dark' ? 'text-neutral-500' : 'text-neutral-450'}`}>ATR Mult</label>
                      <input
                        type="number"
                        step="0.1"
                        data-field="atrMultiplier"
                        value={atrMultiplier}
                        onChange={(e) => setAtrMultiplier(e.target.value)}
                        placeholder="ATR mult"
                        className={`w-full border rounded-lg px-3 py-2 text-xs font-mono transition-all font-semibold focus:outline-none ${
                          theme === 'dark'
                            ? 'bg-neutral-900/85 border-neutral-800 text-neutral-200 focus:border-neutral-600'
                            : 'bg-white border-neutral-200 text-neutral-800 focus:border-neutral-400'
                        }`}
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className={`text-[10px] px-1 font-bold ${theme === 'dark' ? 'text-neutral-500' : 'text-neutral-450'}`}>Risk %</label>
                      <input
                        type="number"
                        step="0.1"
                        data-field="atrRiskPerc"
                        value={atrRiskPerc}
                        onChange={(e) => setAtrRiskPerc(e.target.value)}
                        placeholder="Risk %"
                        className={`w-full border rounded-lg px-3 py-2 text-xs font-mono transition-all font-semibold focus:outline-none ${
                          theme === 'dark'
                            ? 'bg-neutral-900/85 border-neutral-800 text-neutral-200 focus:border-neutral-600'
                            : 'bg-white border-neutral-200 text-neutral-800 focus:border-neutral-400'
                        }`}
                      />
                    </div>
                  </div>

                  {/* Volatility Status Box */}
                  <div className={`p-2 rounded-lg border text-[10px] font-mono flex flex-col gap-1.5 transition-colors ${
                    theme === 'dark' ? 'bg-neutral-950 border-neutral-900 text-neutral-400' : 'bg-neutral-50 border-neutral-200 text-neutral-600'
                  }`}>
                    {atrLoading ? (
                      <div className="flex items-center justify-center gap-2 py-0.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping"></span>
                        <span>ATR sync...</span>
                      </div>
                    ) : atrInfo ? (
                      <>
                        <div className="flex justify-between">
                          <span>ATR (14):</span>
                          <span className="font-bold text-neutral-350 dark:text-neutral-200">{atrInfo.atr_raw.toFixed(5)} ({atrInfo.atr_pips.toFixed(1)} pips)</span>
                        </div>
                        <div className="flex justify-between border-t pt-1 border-neutral-800/40">
                          <span>Target SL ({atrMultiplier}x ATR):</span>
                          <span className="font-bold text-emerald-500 dark:text-emerald-400">
                            {parseFloat((atrInfo.atr_pips * safeParseFloat(atrMultiplier)).toFixed(2))} pips
                          </span>
                        </div>
                      </>
                    ) : (
                      <div className="text-center py-0.5 opacity-60 text-[9.5px]">
                        No Volatility Data Loaded
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3 mt-1">
                    <button
                      data-action="buy-market"
                      disabled={!atrInfo}
                      className="py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs tracking-wide active:scale-95 transition-all flex items-center justify-center gap-1.5 shadow-sm disabled:opacity-40 disabled:pointer-events-none"
                    >
                      <ArrowUpRight size={14} />
                      BUY MKT
                    </button>
                    <button
                      data-action="sell-market"
                      disabled={!atrInfo}
                      className="py-2.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs tracking-wide active:scale-95 transition-all flex items-center justify-center gap-1.5 shadow-sm disabled:opacity-40 disabled:pointer-events-none"
                    >
                      <ArrowDownRight size={14} />
                      SELL MKT
                    </button>
                  </div>
                </div>
              )}

              {/* Pending Limit Mode Form & Matrix */}
              {entryMode === 'pending' && (
                <div className="flex flex-col gap-2.5">
                  {/* Offsets */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex flex-col gap-1">
                      <label className={`text-[9.5px] px-1 font-bold ${theme === 'dark' ? 'text-neutral-500' : 'text-neutral-450'}`}>Buy Offset Pips</label>
                      <div className="relative flex items-center">
                        <input
                          type="number"
                          data-field="entryOffsetBuy"
                          value={entryOffsetBuy}
                          onChange={(e) => setEntryOffsetBuy(e.target.value)}
                          placeholder="Buy offset"
                          className={`w-full pr-7 border rounded-lg px-2.5 py-1.5 text-xs font-mono transition-all font-semibold focus:outline-none ${
                            theme === 'dark'
                              ? 'bg-neutral-900 border-neutral-800 text-neutral-200 focus:border-neutral-600'
                              : 'bg-white border-neutral-200 text-neutral-850 focus:border-neutral-400'
                          }`}
                        />
                        <button
                          type="button"
                          data-action="toggle-dropdown"
                          data-value="entryOffsetBuy"
                          className={`absolute right-1 text-[9px] px-1.5 py-1 hover:bg-neutral-800/10 dark:hover:bg-neutral-800 rounded transition-all ${
                            theme === 'dark' ? 'text-neutral-500 hover:text-neutral-300' : 'text-neutral-400 hover:text-neutral-600'
                          }`}
                        >
                          ▼
                        </button>
                        {activeDropdown === 'entryOffsetBuy' && (
                          <div className={`absolute top-8 right-0 z-50 border rounded shadow-lg flex flex-col gap-1 p-1 w-20 text-[10px] font-bold ${
                            theme === 'dark' ? 'bg-neutral-900 border-neutral-800 text-neutral-200' : 'bg-white border-neutral-200 text-neutral-800'
                          }`}>
                            {['0.0', '1.0', '5.0', '10.0', '20.0'].map(val => (
                              <button
                                key={val}
                                type="button"
                                data-action="select-preset"
                                data-value={`entryOffsetBuy:${val}`}
                                className={`text-left px-2 py-1 rounded transition-all ${
                                  theme === 'dark' ? 'hover:bg-neutral-800' : 'hover:bg-neutral-100'
                                }`}
                              >
                                {val} pips
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className={`text-[9.5px] px-1 font-bold ${theme === 'dark' ? 'text-neutral-500' : 'text-neutral-450'}`}>Sell Offset Pips</label>
                      <div className="relative flex items-center">
                        <input
                          type="number"
                          data-field="entryOffsetSell"
                          value={entryOffsetSell}
                          onChange={(e) => setEntryOffsetSell(e.target.value)}
                          placeholder="Sell offset"
                          className={`w-full pr-7 border rounded-lg px-2.5 py-1.5 text-xs font-mono transition-all font-semibold focus:outline-none ${
                            theme === 'dark'
                              ? 'bg-neutral-900 border-neutral-800 text-neutral-200 focus:border-neutral-600'
                              : 'bg-white border-neutral-200 text-neutral-855 focus:border-neutral-400'
                          }`}
                        />
                        <button
                          type="button"
                          data-action="toggle-dropdown"
                          data-value="entryOffsetSell"
                          className={`absolute right-1 text-[9px] px-1.5 py-1 hover:bg-neutral-800/10 dark:hover:bg-neutral-800 rounded transition-all ${
                            theme === 'dark' ? 'text-neutral-500 hover:text-neutral-300' : 'text-neutral-400 hover:text-neutral-600'
                          }`}
                        >
                          ▼
                        </button>
                        {activeDropdown === 'entryOffsetSell' && (
                          <div className={`absolute top-8 right-0 z-50 border rounded shadow-lg flex flex-col gap-1 p-1 w-20 text-[10px] font-bold ${
                            theme === 'dark' ? 'bg-neutral-900 border-neutral-800 text-neutral-200' : 'bg-white border-neutral-200 text-neutral-800'
                          }`}>
                            {['0.0', '1.0', '5.0', '10.0', '20.0'].map(val => (
                              <button
                                key={val}
                                type="button"
                                data-action="select-preset"
                                data-value={`entryOffsetSell:${val}`}
                                className={`text-left px-2 py-1 rounded transition-all ${
                                  theme === 'dark' ? 'hover:bg-neutral-800' : 'hover:bg-neutral-100'
                                }`}
                              >
                                {val} pips
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Default Toggle Row */}
                  <div className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg border transition-all ${
                    theme === 'dark'
                      ? 'bg-neutral-950/45 border-neutral-800/80'
                      : 'bg-neutral-50 border-neutral-200'
                  }`}>
                    <span className={`text-[10px] font-bold ${theme === 'dark' ? 'text-neutral-400' : 'text-neutral-650'}`}>Use Default (Micro Settings)</span>
                    <button
                      data-action="toggle-limit-use-default"
                      className={`text-[9.5px] uppercase tracking-wider font-extrabold px-3 py-1 rounded transition-all active:scale-95 border ${
                        limitUseDefault
                          ? 'bg-amber-600 border-amber-500 text-white shadow-sm'
                          : theme === 'dark'
                            ? 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:text-neutral-200'
                            : 'bg-white border-neutral-200 text-neutral-550 hover:text-neutral-700'
                      }`}
                    >
                      {limitUseDefault ? 'Active' : 'Off'}
                    </button>
                  </div>

                  {/* SL/TP */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex flex-col gap-1">
                      <label className={`text-[9.5px] px-1 font-bold ${theme === 'dark' ? 'text-neutral-500' : 'text-neutral-450'}`}>Stop Loss Pips</label>
                      <input
                        type="number"
                        data-field="limitSlPips"
                        value={limitUseDefault ? computedDefaultSl.toString() : limitSlPips}
                        disabled={limitUseDefault}
                        onChange={(e) => {
                          setLimitSlPips(e.target.value);
                          const v = parseFloat(e.target.value);
                          if (!isNaN(v)) {
                            setLimitTpPips((v * 2.0).toString());
                          }
                        }}
                        placeholder="SL pips"
                        className={`w-full border rounded-lg px-2.5 py-1.5 text-xs font-mono transition-all font-semibold focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed ${
                          theme === 'dark'
                            ? 'bg-neutral-900 border-neutral-800 text-neutral-200 focus:border-neutral-600'
                            : 'bg-white border-neutral-200 text-neutral-855 focus:border-neutral-400'
                        }`}
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className={`text-[9.5px] px-1 font-bold ${theme === 'dark' ? 'text-neutral-500' : 'text-neutral-450'}`}>Take Profit Pips</label>
                      <input
                        type="number"
                        data-field="limitTpPips"
                        value={limitUseDefault ? computedDefaultTp.toString() : limitTpPips}
                        disabled={limitUseDefault}
                        onChange={(e) => setLimitTpPips(e.target.value)}
                        placeholder="TP pips"
                        className={`w-full border rounded-lg px-2.5 py-1.5 text-xs font-mono transition-all font-semibold focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed ${
                          theme === 'dark'
                            ? 'bg-neutral-900 border-neutral-800 text-neutral-200 focus:border-neutral-600'
                            : 'bg-white border-neutral-200 text-neutral-855 focus:border-neutral-400'
                        }`}
                      />
                    </div>
                  </div>

                  {/* Sizing & Lots */}
                  <div className="flex flex-col gap-1">
                    <div className="flex justify-between items-center px-1">
                      <label className={`text-[9.5px] font-bold ${theme === 'dark' ? 'text-neutral-500' : 'text-neutral-450'}`}>Sizing Mode</label>
                      <div className="flex gap-1.5">
                        <button
                          data-action="change-sizing-mode"
                          data-value="risk"
                          disabled={limitUseDefault}
                          className={`text-[8.5px] uppercase tracking-wider font-extrabold px-1.5 py-0.5 rounded transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                            limitSizingMode === 'risk'
                              ? (theme === 'dark' ? 'bg-neutral-800 text-white' : 'bg-neutral-200 text-neutral-800')
                              : 'text-neutral-500 hover:text-neutral-350'
                          }`}
                        >
                          % Risk
                        </button>
                        <button
                          data-action="change-sizing-mode"
                          data-value="lots"
                          disabled={limitUseDefault}
                          className={`text-[8.5px] uppercase tracking-wider font-extrabold px-1.5 py-0.5 rounded transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                            limitSizingMode === 'lots'
                              ? (theme === 'dark' ? 'bg-neutral-800 text-white' : 'bg-neutral-200 text-neutral-800')
                              : 'text-neutral-500 hover:text-neutral-350'
                          }`}
                        >
                          Lots
                        </button>
                      </div>
                    </div>

                    <input
                      type="number"
                      step={limitSizingMode === 'risk' ? '0.1' : '0.01'}
                      data-field={limitSizingMode === 'risk' ? 'limitRiskPerc' : 'limitLots'}
                      value={limitUseDefault ? '' : (limitSizingMode === 'risk' ? limitRiskPerc : limitLots)}
                      disabled={limitUseDefault}
                      onChange={(e) => {
                        if (limitSizingMode === 'risk') setLimitRiskPerc(e.target.value);
                        else setLimitLots(e.target.value);
                      }}
                      placeholder={limitUseDefault ? 'Default (copier settings)' : (limitSizingMode === 'risk' ? 'Risk %' : 'Lots')}
                      className={`w-full border rounded-lg px-3 py-2 text-xs font-mono transition-all font-semibold focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed ${
                        theme === 'dark'
                          ? 'bg-neutral-900 border-neutral-800 text-neutral-200 focus:border-neutral-600'
                          : 'bg-white border-neutral-200 text-neutral-850 focus:border-neutral-400'
                      }`}
                    />
                  </div>

                  {/* Sized Grid Matrix */}
                  <div className="flex flex-col gap-1.5 mt-1 border-t pt-2 border-neutral-800/20 dark:border-neutral-800/60">
                    <span className={`text-[9px] font-bold uppercase tracking-wider text-center block ${theme === 'dark' ? 'text-neutral-500' : 'text-neutral-400'}`}>
                      Execution Matrix
                    </span>

                    <div className="grid grid-cols-2 gap-2 text-[9.5px] font-bold">
                      {/* BUY GRID */}
                      <div className="flex flex-col gap-1.5">
                        <button
                          data-action="execute-trade"
                          data-value="buy_market"
                          className={`py-1.5 rounded transition-all border ${
                            theme === 'dark'
                              ? 'bg-emerald-950/40 border-emerald-800/80 hover:bg-emerald-900/50 text-emerald-300'
                              : 'bg-emerald-50 border-emerald-200 hover:bg-emerald-100/70 text-emerald-800'
                          }`}
                        >
                          BUY MKT
                        </button>
                        <button
                          data-action="execute-trade"
                          data-value="buy_limit_ask"
                          className={`py-1.5 rounded transition-all border ${
                            theme === 'dark'
                              ? 'bg-neutral-900 border-neutral-800 hover:bg-neutral-800 text-neutral-200'
                              : 'bg-neutral-100 border-neutral-200 hover:bg-neutral-200 text-neutral-800'
                          }`}
                        >
                          Limit Ask
                        </button>
                        <button
                          data-action="execute-trade"
                          data-value="buy_mid"
                          className={`py-1.5 rounded transition-all border ${
                            theme === 'dark'
                              ? 'bg-neutral-900 border-neutral-800 hover:bg-neutral-800 text-neutral-200'
                              : 'bg-neutral-100 border-neutral-200 hover:bg-neutral-200 text-neutral-800'
                          }`}
                        >
                          MID
                        </button>
                        <button
                          data-action="execute-trade"
                          data-value="buy_join_bid"
                          className={`py-1.5 rounded transition-all border ${
                            theme === 'dark'
                              ? 'bg-neutral-900 border-neutral-800 hover:bg-neutral-800 text-neutral-200'
                              : 'bg-neutral-100 border-neutral-200 hover:bg-neutral-200 text-neutral-800'
                          }`}
                        >
                          Join Bid
                        </button>
                        <button
                          data-action="execute-trade"
                          data-value="buy_offset_buy"
                          className={`py-1.5 rounded transition-all border font-bold ${
                            theme === 'dark'
                              ? 'bg-amber-950/30 border-amber-800/80 hover:bg-amber-900/50 text-amber-300'
                              : 'bg-amber-50 border-amber-200 hover:bg-amber-100/70 text-amber-800'
                          }`}
                        >
                          Offset (+{entryOffsetBuy})
                        </button>
                      </div>

                      {/* SELL GRID */}
                      <div className="flex flex-col gap-1.5">
                        <button
                          data-action="execute-trade"
                          data-value="sell_market"
                          className={`py-1.5 rounded transition-all border ${
                            theme === 'dark'
                              ? 'bg-rose-950/40 border-rose-800/80 hover:bg-rose-900/50 text-rose-300'
                              : 'bg-rose-50 border-rose-200 hover:bg-rose-100/70 text-rose-800'
                          }`}
                        >
                          SELL MKT
                        </button>
                        <button
                          data-action="execute-trade"
                          data-value="sell_limit_bid"
                          className={`py-1.5 rounded transition-all border ${
                            theme === 'dark'
                              ? 'bg-neutral-900 border-neutral-800 hover:bg-neutral-800 text-neutral-200'
                              : 'bg-neutral-100 border-neutral-200 hover:bg-neutral-200 text-neutral-800'
                          }`}
                        >
                          Limit Bid
                        </button>
                        <button
                          data-action="execute-trade"
                          data-value="sell_mid"
                          className={`py-1.5 rounded transition-all border ${
                            theme === 'dark'
                              ? 'bg-neutral-900 border-neutral-800 hover:bg-neutral-800 text-neutral-200'
                              : 'bg-neutral-100 border-neutral-200 hover:bg-neutral-200 text-neutral-800'
                          }`}
                        >
                          MID
                        </button>
                        <button
                          data-action="execute-trade"
                          data-value="sell_join_ask"
                          className={`py-1.5 rounded transition-all border ${
                            theme === 'dark'
                              ? 'bg-neutral-900 border-neutral-800 hover:bg-neutral-800 text-neutral-200'
                              : 'bg-neutral-100 border-neutral-200 hover:bg-neutral-200 text-neutral-800'
                          }`}
                        >
                          Join Ask
                        </button>
                        <button
                          data-action="execute-trade"
                          data-value="sell_offset_sell"
                          className={`py-1.5 rounded transition-all border font-bold ${
                            theme === 'dark'
                              ? 'bg-amber-950/30 border-amber-800/80 hover:bg-amber-900/50 text-amber-300'
                              : 'bg-amber-50 border-amber-200 hover:bg-amber-100/70 text-amber-800'
                          }`}
                        >
                          Offset (-{entryOffsetSell})
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: MODIFY ORDER */}
          {executionTab === 'modify' && (
            <div className="flex flex-col gap-3">
              {pendingOrder ? (
                <div className="flex flex-col gap-3">
                  {/* Order detail card */}
                  <div className={`p-3 rounded-lg border flex flex-col gap-2 font-semibold text-xs transition-all ${
                    theme === 'dark' ? 'bg-neutral-950/70 border-neutral-900 text-neutral-250' : 'bg-neutral-50 border-neutral-200 text-neutral-800'
                  }`}>
                    <div className="flex justify-between items-center">
                      <span className={`${theme === 'dark' ? 'text-neutral-500' : 'text-neutral-450'}`}>Order Target:</span>
                      <span className={`px-2 py-0.5 rounded text-[9.5px] font-extrabold ${
                        pendingOrder.direction === 'BUY'
                          ? 'bg-emerald-950/45 text-emerald-500 border border-emerald-900/40 dark:text-emerald-400'
                          : 'bg-rose-950/45 text-rose-500 border border-rose-900/40 dark:text-rose-400'
                      }`}>
                        {pendingOrder.direction} {pendingOrder.orderType.toUpperCase()}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className={`${theme === 'dark' ? 'text-neutral-500' : 'text-neutral-450'}`}>Size / Price:</span>
                      <span className="font-mono font-bold text-neutral-350 dark:text-neutral-200">
                        {pendingOrder.quantity.toFixed(2)} Lots @ {pendingOrder.price.toFixed(5)}
                      </span>
                    </div>
                  </div>

                   {/* Offset Input */}
                   <div className="flex flex-col gap-1">
                     <label className={`text-[10px] px-1 font-bold ${theme === 'dark' ? 'text-neutral-500' : 'text-neutral-450'}`}>
                       Offset Pips
                     </label>
                     <div className="relative flex items-center">
                       <input
                         type="number"
                         data-field={pendingOrder.direction === 'BUY' ? 'modifyOffsetBuy' : 'modifyOffsetSell'}
                         value={pendingOrder.direction === 'BUY' ? modifyOffsetBuy : modifyOffsetSell}
                         onChange={(e) => {
                           if (pendingOrder.direction === 'BUY') setModifyOffsetBuy(e.target.value);
                           else setModifyOffsetSell(e.target.value);
                         }}
                         placeholder="Offset pips"
                         className={`w-full pr-7 border rounded-lg px-3 py-2 text-xs font-mono transition-all font-semibold focus:outline-none ${
                           theme === 'dark'
                             ? 'bg-neutral-900 border-neutral-800 text-neutral-200 focus:border-neutral-600'
                             : 'bg-white border-neutral-200 text-neutral-800 focus:border-neutral-400'
                         }`}
                       />
                       <button
                         type="button"
                         data-action="toggle-dropdown"
                         data-value={pendingOrder.direction === 'BUY' ? 'modifyOffsetBuy' : 'modifyOffsetSell'}
                         className={`absolute right-1 text-[9px] px-1.5 py-1 hover:bg-neutral-800/10 dark:hover:bg-neutral-800 rounded transition-all ${
                           theme === 'dark' ? 'text-neutral-500 hover:text-neutral-300' : 'text-neutral-400 hover:text-neutral-600'
                         }`}
                       >
                         ▼
                       </button>
                       {activeDropdown === (pendingOrder.direction === 'BUY' ? 'modifyOffsetBuy' : 'modifyOffsetSell') && (
                         <div className={`absolute top-10 right-0 z-50 border rounded shadow-lg flex flex-col gap-1 p-1 w-20 text-[10px] font-bold ${
                           theme === 'dark' ? 'bg-neutral-900 border-neutral-800 text-neutral-200' : 'bg-white border-neutral-200 text-neutral-800'
                         }`}>
                           {['0.0', '1.0', '5.0', '10.0', '20.0'].map(val => (
                             <button
                               key={val}
                               type="button"
                               data-action="select-preset"
                               data-value={`${pendingOrder.direction === 'BUY' ? 'modifyOffsetBuy' : 'modifyOffsetSell'}:${val}`}
                               className={`text-left px-2 py-1 rounded transition-all ${
                                 theme === 'dark' ? 'hover:bg-neutral-800' : 'hover:bg-neutral-100'
                               }`}
                             >
                               {val} pips
                             </button>
                           ))}
                         </div>
                       )}
                     </div>
                   </div>

                  {/* Move options grid */}
                  <div className="grid grid-cols-2 gap-2 text-[10px] font-bold mt-1">
                    <button
                      data-action="modify-order"
                      data-value="mkt"
                      className={`py-2 rounded border transition-all ${
                        theme === 'dark' 
                          ? 'bg-neutral-900 border-neutral-800 hover:border-neutral-700 text-neutral-200 hover:bg-neutral-800/40' 
                          : 'bg-white border-neutral-200 hover:border-neutral-300 text-neutral-800 hover:bg-neutral-50'
                      }`}
                    >
                      Move to MKT
                    </button>
                    <button
                      data-action="modify-order"
                      data-value={pendingOrder.direction === 'BUY' ? 'ask' : 'bid'}
                      className={`py-2 rounded border transition-all ${
                        theme === 'dark' 
                          ? 'bg-neutral-900 border-neutral-800 hover:border-neutral-700 text-neutral-200 hover:bg-neutral-800/40' 
                          : 'bg-white border-neutral-200 hover:border-neutral-300 text-neutral-800 hover:bg-neutral-50'
                      }`}
                    >
                      Move to {pendingOrder.direction === 'BUY' ? 'Ask' : 'Bid'}
                    </button>
                    <button
                      data-action="modify-order"
                      data-value="mid"
                      className={`py-2 rounded border transition-all ${
                        theme === 'dark' 
                          ? 'bg-neutral-900 border-neutral-800 hover:border-neutral-700 text-neutral-200 hover:bg-neutral-800/40' 
                          : 'bg-white border-neutral-200 hover:border-neutral-300 text-neutral-800 hover:bg-neutral-50'
                      }`}
                    >
                      Move to MID
                    </button>
                    <button
                      data-action="modify-order"
                      data-value="offset"
                      className="py-2 rounded border transition-all bg-amber-950/20 border-amber-900/40 hover:bg-amber-900/30 text-amber-400 font-extrabold"
                    >
                      Move Offset
                    </button>
                  </div>

                  {/* Cancel working order button */}
                  <button
                    data-action="cancel-order"
                    className="w-full py-2.5 rounded-lg border text-[10.5px] font-bold tracking-wider transition-all flex items-center justify-center gap-2 active:scale-95 mt-1.5 border-rose-900/40 hover:bg-rose-950/20 text-rose-500 dark:text-rose-400"
                  >
                    <XOctagon size={13} />
                    CANCEL WORKING ORDER
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <div className={`p-4 rounded-lg border text-center transition-all ${
                    theme === 'dark' ? 'bg-neutral-950/50 border-neutral-900 text-neutral-500' : 'bg-neutral-50 border-neutral-250 text-neutral-450'
                  }`}>
                    <p className="text-xs font-semibold">No active working order for {selectedSymbol || 'selected symbol'}</p>
                  </div>

                  {/* Suggest alternate active order symbols */}
                  {referenceAccount?.orders && referenceAccount.orders.length > 0 ? (
                    <div className="flex flex-col gap-1.5">
                      <span className={`text-[9.5px] px-1 font-bold ${theme === 'dark' ? 'text-neutral-500' : 'text-neutral-450'}`}>
                        Symbols with Working Orders:
                      </span>
                      <div className="flex flex-wrap gap-2">
                        {Array.from(new Set(referenceAccount.orders.map(o => o.displaySymbol || o.symbol))).map(sym => (
                          <button
                            key={sym}
                            data-action="change-symbol"
                            data-value={sym}
                            onClick={() => setSelectedSymbol(sym)}
                            className={`px-2.5 py-1 rounded text-[9.5px] font-bold border transition-all active:scale-95 ${
                              theme === 'dark'
                                ? 'bg-neutral-900 border-neutral-800 hover:border-neutral-700 text-neutral-350'
                                : 'bg-white border-neutral-250 hover:border-neutral-350 text-neutral-800'
                            }`}
                          >
                            {sym}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="text-center text-[9px] opacity-60">
                      No active orders found.
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: MANAGE POSITION */}
          {executionTab === 'manage' && (
            <div className="flex flex-col gap-3">
              {activePosition ? (
                <div className="flex flex-col gap-3">
                  {/* Position details */}
                  <div className={`p-3 rounded-lg border flex flex-col gap-2 font-semibold text-xs transition-all ${
                    theme === 'dark' ? 'bg-neutral-950/70 border-neutral-900 text-neutral-250' : 'bg-neutral-50 border-neutral-200 text-neutral-800'
                  }`}>
                    <div className="flex justify-between items-center">
                      <span className={`${theme === 'dark' ? 'text-neutral-500' : 'text-neutral-450'}`}>Position:</span>
                      <span className={`px-2 py-0.5 rounded text-[9.5px] font-extrabold ${
                        activePosition.direction === 'BUY'
                          ? 'bg-emerald-950/45 text-emerald-500 border border-emerald-900/40 dark:text-emerald-400'
                          : 'bg-rose-950/45 text-rose-500 border border-rose-900/40 dark:text-rose-400'
                      }`}>
                        {activePosition.direction} ({activePosition.quantity.toFixed(2)} Lots)
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className={`${theme === 'dark' ? 'text-neutral-500' : 'text-neutral-450'}`}>Avg Entry:</span>
                      <span className="font-mono font-bold text-neutral-300 dark:text-neutral-200">
                        {activePosition.avgPrice.toFixed(5)}
                      </span>
                    </div>
                    <div className="flex justify-between items-center border-t pt-1.5 border-neutral-800/30 dark:border-neutral-800/60">
                      <span className={`${theme === 'dark' ? 'text-neutral-500' : 'text-neutral-450'}`}>Unrealized PnL:</span>
                      <span className={`font-mono font-extrabold text-xs ${(activePosition.pnl || 0) >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                        {formatPnlWithPerc(activePosition.pnl, referenceAccount?.cash_value)}
                      </span>
                    </div>
                  </div>

                  {/* Flatten MKT button */}
                  <button
                    data-action="flatten-position"
                    className="w-full py-2.5 rounded-lg text-[10.5px] font-extrabold tracking-wider transition-all flex items-center justify-center gap-2 active:scale-95 shadow-sm bg-rose-600 hover:bg-rose-500 text-white"
                  >
                    <XOctagon size={13} />
                    FLATTEN POSITION MKT
                  </button>

                  {/* Stop Loss update options */}
                  <div className="flex flex-col gap-2 border-t pt-2 border-neutral-800/20 dark:border-neutral-800/60">
                    <span className={`text-[9.5px] font-bold uppercase tracking-wider px-1 ${theme === 'dark' ? 'text-neutral-500' : 'text-neutral-450'}`}>
                      Stop Loss Management
                    </span>
                    
                    <button
                      data-action="position-breakeven"
                      className={`w-full py-1.5 rounded font-bold text-[9.5px] border transition-all active:scale-95 ${
                        theme === 'dark' 
                          ? 'bg-neutral-900 border-neutral-800 hover:border-neutral-700 text-emerald-400 hover:bg-neutral-800/40' 
                          : 'bg-white border-neutral-200 hover:border-neutral-300 text-emerald-600 font-extrabold hover:bg-neutral-50'
                      }`}
                    >
                      MOVE TO BREAKEVEN (B/E)
                    </button>

                    <div className="grid grid-cols-2 gap-2 mt-0.5">
                      <div className="flex flex-col gap-1">
                        <div className="relative flex items-center">
                          <input
                            type="number"
                            data-field="manageSlEntryPips"
                            value={manageSlEntryPips}
                            onChange={(e) => setManageSlEntryPips(e.target.value)}
                            placeholder="From Entry"
                            className={`w-full pr-7 border rounded-lg px-2.5 py-1.5 text-xs font-mono transition-all font-semibold focus:outline-none ${
                              theme === 'dark'
                                ? 'bg-neutral-900 border-neutral-850 text-neutral-250 focus:border-neutral-600'
                                : 'bg-white border-neutral-200 text-neutral-800 focus:border-neutral-400'
                            }`}
                          />
                          <button
                            type="button"
                            data-action="toggle-dropdown"
                            data-value="manageSlEntryPips"
                            className={`absolute right-1 text-[9px] px-1.5 py-1 hover:bg-neutral-800/10 dark:hover:bg-neutral-800 rounded transition-all ${
                              theme === 'dark' ? 'text-neutral-500 hover:text-neutral-300' : 'text-neutral-400 hover:text-neutral-600'
                            }`}
                          >
                            ▼
                          </button>
                          {activeDropdown === 'manageSlEntryPips' && (
                            <div className={`absolute top-8 right-0 z-50 border rounded shadow-lg flex flex-col gap-1 p-1 w-20 text-[10px] font-bold ${
                              theme === 'dark' ? 'bg-neutral-900 border-neutral-800 text-neutral-200' : 'bg-white border-neutral-200 text-neutral-800'
                            }`}>
                              {['0.0', '1.0', '5.0', '10.0', '20.0'].map(val => (
                                <button
                                  key={val}
                                  type="button"
                                  data-action="select-preset"
                                  data-value={`manageSlEntryPips:${val}`}
                                  className={`text-left px-2 py-1 rounded transition-all ${
                                    theme === 'dark' ? 'hover:bg-neutral-800' : 'hover:bg-neutral-100'
                                  }`}
                                >
                                  {val} pips
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                        <button
                          data-action="position-sl-entry"
                          className="py-1 rounded bg-neutral-900 hover:bg-neutral-850 dark:bg-neutral-950 dark:hover:bg-neutral-900 dark:border-neutral-800 text-neutral-300 text-[8.5px] font-bold uppercase border active:scale-95 transition-all"
                        >
                          SL from Entry
                        </button>
                      </div>

                      <div className="flex flex-col gap-1">
                        <div className="relative flex items-center">
                          <input
                            type="number"
                            data-field="manageSlMidPips"
                            value={manageSlMidPips}
                            onChange={(e) => setManageSlMidPips(e.target.value)}
                            placeholder="From Mid"
                            className={`w-full pr-7 border rounded-lg px-2.5 py-1.5 text-xs font-mono transition-all font-semibold focus:outline-none ${
                              theme === 'dark'
                                ? 'bg-neutral-900 border-neutral-850 text-neutral-250 focus:border-neutral-600'
                                : 'bg-white border-neutral-200 text-neutral-800 focus:border-neutral-400'
                            }`}
                          />
                          <button
                            type="button"
                            data-action="toggle-dropdown"
                            data-value="manageSlMidPips"
                            className={`absolute right-1 text-[9px] px-1.5 py-1 hover:bg-neutral-800/10 dark:hover:bg-neutral-800 rounded transition-all ${
                              theme === 'dark' ? 'text-neutral-500 hover:text-neutral-300' : 'text-neutral-400 hover:text-neutral-600'
                            }`}
                          >
                            ▼
                          </button>
                          {activeDropdown === 'manageSlMidPips' && (
                            <div className={`absolute top-8 right-0 z-50 border rounded shadow-lg flex flex-col gap-1 p-1 w-20 text-[10px] font-bold ${
                              theme === 'dark' ? 'bg-neutral-900 border-neutral-800 text-neutral-200' : 'bg-white border-neutral-200 text-neutral-800'
                            }`}>
                              {['0.0', '1.0', '5.0', '10.0', '20.0'].map(val => (
                                <button
                                  key={val}
                                  type="button"
                                  data-action="select-preset"
                                  data-value={`manageSlMidPips:${val}`}
                                  className={`text-left px-2 py-1 rounded transition-all ${
                                    theme === 'dark' ? 'hover:bg-neutral-800' : 'hover:bg-neutral-100'
                                  }`}
                                >
                                  {val} pips
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                        <button
                          data-action="position-sl-mid"
                          className="py-1 rounded bg-neutral-900 hover:bg-neutral-850 dark:bg-neutral-950 dark:hover:bg-neutral-900 dark:border-neutral-800 text-neutral-300 text-[8.5px] font-bold uppercase border active:scale-95 transition-all"
                        >
                          SL from Mid
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Take Profit update options */}
                  <div className="flex flex-col gap-2 border-t pt-2 border-neutral-800/20 dark:border-neutral-800/60">
                    <span className={`text-[9.5px] font-bold uppercase tracking-wider px-1 ${theme === 'dark' ? 'text-neutral-500' : 'text-neutral-450'}`}>
                      Take Profit Management
                    </span>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="flex flex-col gap-1">
                        <div className="relative flex items-center">
                          <input
                            type="number"
                            data-field="manageTpEntryPips"
                            value={manageTpEntryPips}
                            onChange={(e) => setManageTpEntryPips(e.target.value)}
                            placeholder="From Entry"
                            className={`w-full pr-7 border rounded-lg px-2.5 py-1.5 text-xs font-mono transition-all font-semibold focus:outline-none ${
                              theme === 'dark'
                                ? 'bg-neutral-900 border-neutral-850 text-neutral-250 focus:border-neutral-600'
                                : 'bg-white border-neutral-200 text-neutral-800 focus:border-neutral-400'
                            }`}
                          />
                          <button
                            type="button"
                            data-action="toggle-dropdown"
                            data-value="manageTpEntryPips"
                            className={`absolute right-1 text-[9px] px-1.5 py-1 hover:bg-neutral-800/10 dark:hover:bg-neutral-800 rounded transition-all ${
                              theme === 'dark' ? 'text-neutral-500 hover:text-neutral-300' : 'text-neutral-400 hover:text-neutral-600'
                            }`}
                          >
                            ▼
                          </button>
                          {activeDropdown === 'manageTpEntryPips' && (
                            <div className={`absolute top-8 right-0 z-50 border rounded shadow-lg flex flex-col gap-1 p-1 w-20 text-[10px] font-bold ${
                              theme === 'dark' ? 'bg-neutral-900 border-neutral-800 text-neutral-200' : 'bg-white border-neutral-200 text-neutral-800'
                            }`}>
                              {['0.0', '1.0', '5.0', '10.0', '20.0'].map(val => (
                                <button
                                  key={val}
                                  type="button"
                                  data-action="select-preset"
                                  data-value={`manageTpEntryPips:${val}`}
                                  className={`text-left px-2 py-1 rounded transition-all ${
                                    theme === 'dark' ? 'hover:bg-neutral-800' : 'hover:bg-neutral-100'
                                  }`}
                                >
                                  {val} pips
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                        <button
                          data-action="position-tp-entry"
                          className="py-1 rounded bg-neutral-900 hover:bg-neutral-850 dark:bg-neutral-950 dark:hover:bg-neutral-900 dark:border-neutral-800 text-neutral-300 text-[8.5px] font-bold uppercase border active:scale-95 transition-all"
                        >
                          TP from Entry
                        </button>
                      </div>

                      <div className="flex flex-col gap-1">
                        <div className="relative flex items-center">
                          <input
                            type="number"
                            data-field="manageTpMidPips"
                            value={manageTpMidPips}
                            onChange={(e) => setManageTpMidPips(e.target.value)}
                            placeholder="From Mid"
                            className={`w-full pr-7 border rounded-lg px-2.5 py-1.5 text-xs font-mono transition-all font-semibold focus:outline-none ${
                              theme === 'dark'
                                ? 'bg-neutral-900 border-neutral-850 text-neutral-250 focus:border-neutral-600'
                                : 'bg-white border-neutral-200 text-neutral-800 focus:border-neutral-400'
                            }`}
                          />
                          <button
                            type="button"
                            data-action="toggle-dropdown"
                            data-value="manageTpMidPips"
                            className={`absolute right-1 text-[9px] px-1.5 py-1 hover:bg-neutral-800/10 dark:hover:bg-neutral-800 rounded transition-all ${
                              theme === 'dark' ? 'text-neutral-500 hover:text-neutral-300' : 'text-neutral-400 hover:text-neutral-600'
                            }`}
                          >
                            ▼
                          </button>
                          {activeDropdown === 'manageTpMidPips' && (
                            <div className={`absolute top-8 right-0 z-50 border rounded shadow-lg flex flex-col gap-1 p-1 w-20 text-[10px] font-bold ${
                              theme === 'dark' ? 'bg-neutral-900 border-neutral-800 text-neutral-200' : 'bg-white border-neutral-200 text-neutral-800'
                            }`}>
                              {['0.0', '1.0', '5.0', '10.0', '20.0'].map(val => (
                                <button
                                  key={val}
                                  type="button"
                                  data-action="select-preset"
                                  data-value={`manageTpMidPips:${val}`}
                                  className={`text-left px-2 py-1 rounded transition-all ${
                                    theme === 'dark' ? 'hover:bg-neutral-800' : 'hover:bg-neutral-100'
                                  }`}
                                >
                                  {val} pips
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                        <button
                          data-action="position-tp-mid"
                          className="py-1 rounded bg-neutral-900 hover:bg-neutral-850 dark:bg-neutral-950 dark:hover:bg-neutral-900 dark:border-neutral-800 text-neutral-300 text-[8.5px] font-bold uppercase border active:scale-95 transition-all"
                        >
                          TP from Mid
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <div className={`p-4 rounded-lg border text-center transition-all ${
                    theme === 'dark' ? 'bg-neutral-950/50 border-neutral-900 text-neutral-500' : 'bg-neutral-50 border-neutral-250 text-neutral-450'
                  }`}>
                    <p className="text-xs font-semibold">No active position for {selectedSymbol || 'selected symbol'}</p>
                  </div>

                  {/* Suggest alternate active position symbols */}
                  {referenceAccount?.positions && referenceAccount.positions.length > 0 ? (
                    <div className="flex flex-col gap-1.5">
                      <span className={`text-[9.5px] px-1 font-bold ${theme === 'dark' ? 'text-neutral-500' : 'text-neutral-450'}`}>
                        Symbols with Active Positions:
                      </span>
                      <div className="flex flex-wrap gap-2">
                        {Array.from(new Set(referenceAccount.positions.map(p => p.displaySymbol || p.symbol))).map(sym => (
                          <button
                            key={sym}
                            data-action="change-symbol"
                            data-value={sym}
                            onClick={() => setSelectedSymbol(sym)}
                            className={`px-2.5 py-1 rounded text-[9.5px] font-bold border transition-all active:scale-95 ${
                              theme === 'dark'
                                ? 'bg-neutral-900 border-neutral-800 hover:border-neutral-700 text-neutral-350'
                                : 'bg-white border-neutral-250 hover:border-neutral-350 text-neutral-800'
                            }`}
                          >
                            {sym}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="text-center text-[9px] opacity-60">
                      No active positions found.
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Embedded Micro Pad Panel */}
          {showMicroPanel && (
            <div className={`mt-3.5 pt-3.5 border-t flex flex-col gap-2.5 ${
              theme === 'dark' ? 'border-neutral-800/60' : 'border-neutral-200/60'
            }`}>
              <div className="flex justify-between items-center px-0.5">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-neutral-400">Micro Execution Pad</span>
                <span className="text-[8.5px] font-mono opacity-50">Scale-risk (SL)</span>
              </div>

              {/* Micro Pad main controls */}
              <div className="flex items-center justify-between gap-2.5 flex-nowrap">
                <div className="relative flex items-center flex-shrink-0">
                  <select
                    data-field="microSymbol"
                    value={microSymbol}
                    onChange={(e) => setMicroSymbol(e.target.value)}
                    disabled={wsStatus !== 'connected'}
                    className={`pl-2 pr-8 py-1.5 text-xs font-semibold tracking-wide uppercase transition-all duration-200 border rounded-lg appearance-none cursor-pointer focus:outline-none ${
                      theme === 'dark'
                        ? 'bg-neutral-900 border-neutral-800 text-neutral-200 hover:bg-neutral-850 hover:border-neutral-750'
                        : 'bg-neutral-50 border-neutral-200 text-neutral-850 hover:bg-neutral-100 hover:border-neutral-300'
                    }`}
                  >
                    <option value="">---</option>
                    {symbols.map((sym) => (
                      <option key={sym} value={sym}>
                        {sym}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-2.5 w-3.5 h-3.5 text-neutral-450 pointer-events-none" />
                </div>

                <div className={`flex items-center gap-1 px-2.5 py-1.5 text-[10.5px] font-mono font-bold rounded-lg border ${
                  theme === 'dark'
                    ? 'bg-neutral-900/40 border-neutral-800/60 text-neutral-400'
                    : 'bg-neutral-50 border-neutral-200/60 text-neutral-500'
                }`}>
                  <span className="text-[9.5px] text-neutral-400 uppercase tracking-wider mr-0.5">SL:</span>
                  {microIsFetchingAtr ? (
                    <span className="w-8 h-3.5 bg-neutral-200 dark:bg-neutral-850 rounded animate-pulse" />
                  ) : microAtrPips !== null ? (
                    <span className="text-neutral-700 dark:text-neutral-200 font-extrabold">
                      {microAtrPips.toFixed(2)} <span className="text-[8.5px] font-normal opacity-60">pips</span>
                    </span>
                  ) : (
                    <span className="opacity-50">N/A</span>
                  )}
                </div>
              </div>

              {/* Micro Pad Action Buttons */}
              <div className="grid grid-cols-7 gap-2">
                <button
                  data-action="micro-buy"
                  disabled={wsStatus !== 'connected' || microAtrPips === null}
                  className="col-span-3 flex items-center justify-center gap-1.5 py-2 px-3 font-bold text-xs rounded-xl text-white bg-emerald-600 hover:bg-emerald-500 active:scale-95 disabled:opacity-30 disabled:pointer-events-none transition-all duration-150 shadow-sm"
                >
                  <TrendingUp className="w-3.5 h-3.5" />
                  <span>BUY MKT</span>
                </button>

                <button
                  data-action="micro-sell"
                  disabled={wsStatus !== 'connected' || microAtrPips === null}
                  className="col-span-3 flex items-center justify-center gap-1.5 py-2 px-3 font-bold text-xs rounded-xl text-white bg-rose-600 hover:bg-rose-500 active:scale-95 disabled:opacity-30 disabled:pointer-events-none transition-all duration-150 shadow-sm"
                >
                  <TrendingDown className="w-3.5 h-3.5" />
                  <span>SELL MKT</span>
                </button>

                <button
                  data-action="micro-flatten"
                  disabled={wsStatus !== 'connected' || !microSymbol}
                  className={`col-span-1 flex items-center justify-center py-2 px-2 font-bold rounded-xl border active:scale-95 disabled:opacity-30 disabled:pointer-events-none transition-all duration-150 ${
                    theme === 'dark'
                      ? 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:bg-neutral-800'
                      : 'bg-neutral-100 border-neutral-200 text-neutral-600 hover:bg-neutral-205'
                  }`}
                  title="Flatten micro selected instrument"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* Footer Status Message / popout bar */}
          <div className="flex items-center justify-between gap-2.5 px-0.5 mt-3 pt-2.5 border-t border-neutral-800/10 dark:border-neutral-800/50 text-[10.5px] text-neutral-400 font-mono tracking-tight font-medium flex-nowrap">
            <div className="truncate flex-grow">
              {message.text ? (
                <span className={`flex items-center gap-1 font-semibold ${
                  message.type === 'success' 
                    ? 'text-emerald-600 dark:text-emerald-450' 
                    : message.type === 'danger' 
                    ? 'text-rose-600 dark:text-rose-450' 
                    : message.type === 'warning' 
                    ? 'text-amber-600 dark:text-amber-550' 
                    : 'text-neutral-500'
                }`}>
                  <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                  <span className="truncate">{message.text}</span>
                </span>
              ) : (
                <span className="text-neutral-450 dark:text-neutral-500">Ready</span>
              )}
            </div>
            
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <button 
                data-action="toggle-micro"
                title="Toggle embedded Micro Pad"
                className={`py-1 px-1.5 rounded transition-all border text-[9.5px] font-bold ${
                  showMicroPanel
                    ? 'bg-emerald-600 border-emerald-500 text-white'
                    : (theme === 'dark'
                      ? 'bg-neutral-900 border-neutral-800 hover:border-neutral-700 text-neutral-400 hover:text-neutral-250'
                      : 'bg-white border-neutral-200 hover:border-neutral-350 text-neutral-500 hover:text-neutral-700')
                }`}
              >
                MICRO PAD
              </button>

              <button 
                data-action="manual-refresh"
                title="Sync reference data"
                className={`p-1.5 rounded transition-all border ${
                  theme === 'dark'
                    ? 'bg-neutral-900 border-neutral-800 hover:border-neutral-700 text-neutral-400 hover:text-neutral-200'
                    : 'bg-white border-neutral-200 hover:border-neutral-350 text-neutral-500 hover:text-neutral-700'
                }`}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${wsStatus === 'connecting' ? 'animate-spin' : ''}`} />
              </button>

              <button 
                data-action="toggle-theme"
                title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} theme`}
                className={`p-1.5 rounded transition-all border ${
                  theme === 'dark'
                    ? 'bg-neutral-900 border-neutral-800 hover:border-neutral-700 text-amber-400 hover:text-amber-300'
                    : 'bg-white border-neutral-200 hover:border-neutral-350 text-neutral-500 hover:text-neutral-750'
                }`}
              >
                {theme === 'dark' ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
              </button>

              {typeof window !== 'undefined' && 'documentPictureInPicture' in window && (
                <button 
                  data-action="pop-out"
                  title="Float on Chart (PiP Mode)"
                  className={`flex items-center gap-0.5 py-1 px-1.5 rounded transition-all border text-[9.5px] font-bold font-mono ${
                    theme === 'dark'
                      ? 'bg-neutral-900 border-neutral-800 hover:border-neutral-700 text-neutral-300 hover:text-neutral-100'
                      : 'bg-white border-neutral-250 hover:border-neutral-350 text-neutral-600 hover:text-neutral-850'
                  }`}
                >
                  <span>POP OUT</span>
                  <ExternalLink className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
