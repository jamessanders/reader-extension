# gemma-server.spec — PyInstaller build spec for the Gemma LLM server.
# Build:  pyinstaller gemma-server.spec
# Output: dist/gemma-server  (single binary)

from PyInstaller.utils.hooks import collect_all

llama_datas, llama_binaries, llama_hiddenimports = collect_all("llama_cpp")

a = Analysis(
    ["server.py"],
    pathex=[],
    binaries=llama_binaries,
    datas=llama_datas,
    hiddenimports=llama_hiddenimports + [
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
        "huggingface_hub",
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
    name="gemma-server",
    console=True,
    onefile=True,
    strip=False,
)
