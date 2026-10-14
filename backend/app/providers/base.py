import os
class ProviderNotConnected(Exception): pass
class BaseProvider:
    env_key = ""
    name = "base"
    @property
    def connected(self): return bool(os.getenv(self.env_key))
    def require(self):
        if not self.connected: raise ProviderNotConnected(f"{self.name}: provider not connected (set {self.env_key})")
