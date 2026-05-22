import os
import json
import logging
from pathlib import Path
from typing import Dict, Any, List

logger = logging.getLogger("backend.config")

# Default path relative to this backend folder
DEFAULT_SETTINGS_PATH = Path(__file__).resolve().parent.parent / "scripts" / "propfundsettings.json"

class Config:
    def __init__(self):
        self.settings_path = Path(os.getenv("SETTINGS_PATH", str(DEFAULT_SETTINGS_PATH)))
        self.data: Dict[str, Any] = {}
        self.load()

    def load(self):
        logger.info(f"Loading configuration from: {self.settings_path}")
        try:
            if not self.settings_path.exists():
                raise FileNotFoundError(f"Configuration file not found at {self.settings_path}")
            
            with open(self.settings_path, "r", encoding="utf-8") as f:
                self.data = json.load(f)
                
            logger.info("Configuration successfully loaded.")
        except Exception as e:
            logger.error(f"Failed to load settings from {self.settings_path}: {e}")
            raise e

    @property
    def global_names(self) -> List[str]:
        return self.data.get("GlobalNames", [])

    @property
    def default_sl_pips(self) -> Dict[str, float]:
        return self.data.get("DefaultSLPips", {})

    @property
    def reference_acc_type(self) -> str:
        return self.data.get("ReferenceAccType", "MT5Accounts")

    @property
    def reference_acc_name(self) -> str:
        return self.data.get("ReferenceAccName", "")

    @property
    def mt5_accounts(self) -> List[Dict[str, Any]]:
        return self.data.get("MT5Accounts", {}).get("Accounts", [])

    @property
    def future_accounts(self) -> List[Dict[str, Any]]:
        return self.data.get("FutureAccounts", {}).get("Accounts", [])

    @property
    def ibkr_accounts(self) -> List[Dict[str, Any]]:
        return self.data.get("IBKRAccounts", {}).get("Accounts", [])

    def get_all_accounts(self) -> List[Dict[str, Any]]:
        """Returns all configured accounts from all types, injecting their account type."""
        all_accs = []
        for acc in self.mt5_accounts:
            acc_copy = acc.copy()
            acc_copy["type"] = "MT5"
            all_accs.append(acc_copy)
        for acc in self.future_accounts:
            acc_copy = acc.copy()
            acc_copy["type"] = "Future"
            all_accs.append(acc_copy)
        for acc in self.ibkr_accounts:
            acc_copy = acc.copy()
            acc_copy["type"] = "IBKR"
            all_accs.append(acc_copy)
        return all_accs

# Global configuration instance
settings = Config()
