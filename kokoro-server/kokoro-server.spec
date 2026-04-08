# kokoro-server.spec — PyInstaller build spec for the Kokoro TTS server.
# Build:  pyinstaller kokoro-server.spec
# Output: dist/kokoro-server  (single binary)

from PyInstaller.utils.hooks import collect_all

ort_datas,    ort_binaries,    ort_hiddenimports    = collect_all("onnxruntime")
kokoro_datas, kokoro_binaries, kokoro_hiddenimports = collect_all("kokoro_onnx")
misaki_datas, misaki_binaries, misaki_hiddenimports = collect_all("misaki")

a = Analysis(
    ["server.py"],
    pathex=[],
    binaries=ort_binaries + kokoro_binaries + misaki_binaries,
    datas=ort_datas + kokoro_datas + misaki_datas,
    hiddenimports=ort_hiddenimports + kokoro_hiddenimports + misaki_hiddenimports + [
        "uvicorn.logging",
        "uvicorn.loops",
        "uvicorn.loops.auto",
        "uvicorn.protocols",
        "uvicorn.protocols.http",
        "uvicorn.protocols.http.auto",
        "uvicorn.protocols.http.h11_impl",
        "uvicorn.protocols.websockets",
        "uvicorn.protocols.websockets.auto",
        "uvicorn.lifespan",
        "uvicorn.lifespan.on",
        "anyio",
        "anyio._backends._asyncio",
        "anyio._backends._trio",
        "starlette.routing",
        "misaki.en",
        "misaki.espeak",
        "httpx",
        "numpy",
    ],
    hookspath=[],
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    name="kokoro-server",
    console=True,
    onefile=True,
    strip=False,
)
