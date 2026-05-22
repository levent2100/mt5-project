import httpx
import logging
from typing import Dict, Any, List, Optional

logger = logging.getLogger("backend.bridge")

class BridgeClient:
    def __init__(self, base_url: str, timeout: float = 8.0):
        # Ensure base_url has no trailing slash
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    async def _post(self, request_name: str, payload: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Base async helper to send a command to the MT5 HTTP bridge."""
        if payload is None:
            payload = {}
        
        # Structure the payload as expected by RequestHandler in mt5_http_bridge1.py
        payload["request"] = request_name
        
        url = self.base_url
        logger.debug(f"Sending request '{request_name}' to bridge: {url}")
        
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(url, json=payload)
                if response.status_code == 200:
                    return response.json()
                else:
                    logger.warning(f"Bridge {url} returned status code {response.status_code}: {response.text}")
                    return {
                        "success": False,
                        "error": f"Bridge returned HTTP status {response.status_code}"
                    }
        except httpx.RequestError as exc:
            logger.error(f"HTTP request failed to bridge {url}: {exc}")
            return {
                "success": False,
                "error": f"Bridge unreachable: {exc}"
            }
        except Exception as exc:
            logger.exception(f"Unexpected error communicating with bridge {url}:")
            return {
                "success": False,
                "error": f"Internal communication error: {exc}"
            }

    async def get_account_status(self) -> Dict[str, Any]:
        """Fetch balance, margin, positions, and orders from this bridge."""
        res = await self._post("accountstatus")
        # Standardize success status if bridge returned list
        if "accounts" in res and isinstance(res["accounts"], list) and len(res["accounts"]) > 0:
            return {
                "success": True,
                "account_data": res["accounts"][0]
            }
        return {
            "success": False,
            "error": res.get("error") or "Invalid response format from bridge"
        }

    async def get_spreads(self, instruments: List[str]) -> Dict[str, Any]:
        """Fetch active bid/ask spreads for a list of global instruments."""
        return await self._post("getspreads", {"instruments": instruments})

    async def execute_trade(self, trades: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Execute a market or pending order on this bridge."""
        return await self._post("trade", {"trades": trades})

    async def cancel_and_flatten(self, instrument: Optional[str] = None) -> Dict[str, Any]:
        """Cancel pending orders and close all open positions (optionally for a specific symbol)."""
        payload = {}
        if instrument:
            payload["instrument"] = instrument
        return await self._post("cancelandflatten", payload)

    async def move_stoploss_to_breakeven(self, instrument: str) -> Dict[str, Any]:
        """Move the SL of active positions for this symbol to breakeven."""
        return await self._post("movestoploss", {"instrument": instrument})

    async def manage_position_stops(self, symbol: str, sl_payload: Optional[Dict[str, Any]] = None, tp_payload: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Update stop-loss or take-profit settings on an active position."""
        payload = {"symbol": symbol}
        if sl_payload:
            payload["sl"] = sl_payload
        if tp_payload:
            payload["tp"] = tp_payload
        return await self._post("manage_position_stops", {"payload": payload})

    async def modify_order(self, instrument: str, new_price_type: str, offset_pips: float = 0.0) -> Dict[str, Any]:
        """Modify a pending order's price."""
        return await self._post("modify_order", {
            "instrument": instrument,
            "new_price_type": new_price_type,
            "offset_pips": offset_pips
        })

    async def cancel_order(self, instrument: str) -> Dict[str, Any]:
        """Cancel a specific symbol's pending order."""
        return await self._post("cancel_order", {"instrument": instrument})
