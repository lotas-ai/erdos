"""Entry point for launching Erdos's extensions to Jedi and WebSocket Kernel in the same environment."""  # noqa: INP001

import argparse
import asyncio
import logging
import os
import sys
from pathlib import Path

# Set matplotlib backend BEFORE any imports that might trigger matplotlib initialization
# This MUST be done before matplotlib is imported anywhere, including during package discovery
if not os.environ.get("MPLBACKEND"):
    os.environ["MPLBACKEND"] = "module://erdos.plotting"

# Add lotas to path for vendor imports
sys.path.insert(0, str(Path(__file__).parent))

from erdos.zmq_websocket_proxy import ZMQWebSocketProxy
from erdos.kernel_mode import KernelMode

logger = logging.getLogger(__name__)


def parse_kernel_mode(value: str) -> KernelMode:
    """Convert string argument to KernelMode."""
    # Try as integer first
    try:
        return KernelMode(int(value))
    except (ValueError, KeyError):
        pass
    
    # Try as name
    value_upper = value.upper()
    for mode in KernelMode:
        if mode.name == value_upper:
            return mode
    
    raise argparse.ArgumentTypeError(
        f"Invalid kernel mode: {value}. Must be 0 (CONSOLE), 1 (NOTEBOOK), 2 (BACKGROUND), "
        f"or one of: console, notebook, background"
    )


def parse_args() -> argparse.Namespace:
    """Parse command-line arguments."""
    parser = argparse.ArgumentParser(
        prog="erdos-websocket-language-server",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        description="Erdos WebSocket language server: combines Jedi LSP with WebSocket kernel.",
    )

    parser.add_argument(
        "--debugport",
        help="port for debugpy debugger",
        type=int,
        default=None,
    )
    parser.add_argument(
        "--logfile",
        help="redirect logs to file specified",
        type=str,
    )
    parser.add_argument(
        "--loglevel",
        help="logging level",
        type=str,
        default="error",
        choices=["critical", "error", "warn", "info", "debug"],
    )
    parser.add_argument(
        "--websocket-port",
        help="WebSocket port for kernel communication",
        type=int,
        default=8080,
    )
    parser.add_argument(
        "-q",
        "--quiet",
        help="Suppress console startup banner information",
        action="store_true",
    )
    parser.add_argument(
        "--session-mode",
        help="session mode: 0/console (default), 1/notebook, or 2/background",
        type=parse_kernel_mode,
        default=KernelMode.CONSOLE,
    )
    args = parser.parse_args()
    args.loglevel = args.loglevel.upper()

    return args


def configure_logging(args: argparse.Namespace):
    """Configure logging for the language server."""
    handlers = ["console"] if args.logfile is None else ["file"]
    
    logging_config = {
        "version": 1,
        "formatters": {
            "console": {
                "format": "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
            }
        },
        "loggers": {
            "erdos": {
                "level": args.loglevel,
                "handlers": handlers,
            },
            "asyncio": {
                "level": args.loglevel,
                "handlers": handlers,
            },
        },
    }
    
    if args.logfile is not None:
        logging_config["handlers"] = {
            "file": {
                "class": "logging.FileHandler",
                "formatter": "console",
                "level": args.loglevel,
                "filename": args.logfile,
            }
        }
    else:
        logging_config["handlers"] = {
            "console": {
                "class": "logging.StreamHandler",
                "formatter": "console",
                "level": args.loglevel,
                "stream": "ext://sys.stderr",
            }
        }
    
    logging.config.dictConfig(logging_config)


async def main():
    """Main entry point for the WebSocket language server."""
    exit_status = 0

    # Parse command-line arguments
    args = parse_args()

    # Configure logging
    import logging.config
    configure_logging(args)

    # Start the debugpy debugger if a port was specified
    if args.debugport is not None:
        try:
            import debugpy
            debugpy.listen(args.debugport)
            logger.info(f"Debugpy listening on port {args.debugport}")
        except Exception as error:
            logger.warning(f"Unable to start debugpy: {error}", exc_info=True)

    # Enable asyncio debug mode
    if args.loglevel == "DEBUG":
        asyncio.get_event_loop().set_debug(True)
        asyncio.get_event_loop().slow_callback_duration = 0.5

    # Convert KernelMode enum to string for proxy
    session_mode_str = args.session_mode.name.lower()
    
    # Create and start the ZMQ-WebSocket proxy
    proxy = ZMQWebSocketProxy(
        shell_port=args.websocket_port,
        control_port=args.websocket_port + 1,
        session_mode=session_mode_str
    )

    logger.info(f"Process ID {os.getpid()}")
    logger.info(f"Starting proxy: shell port {args.websocket_port}, control port {args.websocket_port + 1}")

    try:
        await proxy.start()
    except (KeyboardInterrupt, SystemExit):
        logger.info("Received shutdown signal")
        exit_status = 0
    except Exception as e:
        logger.exception(f"Unexpected exception in proxy: {e}")
        exit_status = 1
    finally:
        await proxy.stop()
        logger.info(f"Exiting process with status {exit_status}")
        return exit_status


if __name__ == "__main__":
    try:
        exit_status = asyncio.run(main())
        sys.exit(exit_status)
    except KeyboardInterrupt:
        logger.info("Interrupted by user")
        sys.exit(0)


