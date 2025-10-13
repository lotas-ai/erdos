# Copyright (C) 2025 Lotas Inc. All rights reserved.
# Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.

"""Custom matplotlib backend for Erdos that sends plots to VS Code as base64-encoded images."""

from __future__ import annotations

import base64
import io
import logging
from typing import TYPE_CHECKING

import matplotlib
from matplotlib.backend_bases import FigureManagerBase
from matplotlib.backends.backend_agg import FigureCanvasAgg

if TYPE_CHECKING:
    from matplotlib.figure import Figure

logger = logging.getLogger(__name__)

matplotlib.interactive(True)


class FigureManagerErdos(FigureManagerBase):
    canvas: FigureCanvasErdos

    def __init__(self, canvas: FigureCanvasErdos, num: int | str):
        super().__init__(canvas, num)

    def show(self) -> None:
        """Show the plot by rendering to PNG and sending as display_data."""
        try:
            buffer = io.BytesIO()
            self.canvas.figure.savefig(buffer, format='png', bbox_inches='tight')
            buffer.seek(0)
            png_data = base64.b64encode(buffer.read()).decode('utf-8')
            buffer.close()
            
            from IPython import get_ipython
            ip = get_ipython()
            if ip is not None:
                ip.display_pub.publish(
                    data={'image/png': png_data},
                    metadata={}
                )
            
            # Close the figure after displaying to prevent it from showing again
            # This matches R's behavior where each plot gets its own batch
            import matplotlib.pyplot as plt
            plt.close(self.canvas.figure)
        except Exception as e:
            logger.error(f"Error displaying plot: {e}", exc_info=True)

    def destroy(self) -> None:
        """Destroy the figure."""
        pass

    def update(self) -> None:
        """Update is not needed for non-dynamic plots."""
        pass


class FigureCanvasErdos(FigureCanvasAgg):
    manager: FigureManagerErdos

    manager_class = FigureManagerErdos

    def __init__(self, figure: Figure | None = None) -> None:
        super().__init__(figure)

    def draw(self, *, is_rendering=False) -> None:
        logger.debug("Drawing to canvas")
        super().draw()


FigureCanvas = FigureCanvasErdos
FigureManager = FigureManagerErdos
