from .base import BaseProvider, ProviderNotConnected
class OpenAIProvider(BaseProvider):
    env_key="OPENAI_API_KEY"; name="openai"
    async def reason(self, prompt: str):
        self.require()  # Real call wired when key is present; never fake output.
        raise ProviderNotConnected("openai: SDK call not configured in this build")
class TripoProvider(BaseProvider):
    env_key="TRIPO_API_KEY"; name="tripo"
    async def text_to_3d(self, prompt: str):
        self.require(); raise ProviderNotConnected("tripo: job submission not configured in this build")
class MeshyProvider(BaseProvider):
    env_key="MESHY_API_KEY"; name="meshy"
    async def text_to_3d(self, prompt: str):
        self.require(); raise ProviderNotConnected("meshy: job submission not configured in this build")
class ImageProvider(BaseProvider):
    env_key="IMAGE_API_KEY"; name="image"
class VideoProvider(BaseProvider):
    env_key="VIDEO_API_KEY"; name="video"
class AudioProvider(BaseProvider):
    env_key="AUDIO_API_KEY"; name="audio"
