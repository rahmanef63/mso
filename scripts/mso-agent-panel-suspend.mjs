import { disableMouse, enableMouse } from "./mso-agent-mouse.mjs";
import { enterScreen, leaveScreen } from "./mso-agent-altscreen.mjs";

/**
 * A line oriented prompt needs the terminal to itself, so the panel LEAVES the alternate screen for
 * the duration. Detaching the sink alone is not enough: the prompt would be painted into the
 * alternate buffer, where the next repaint overwrites it, so the user would answer a question that
 * vanished before they could read it. Leaving gives the prompt the normal screen and its own
 * scrollback, and resume re-enters and repaints.
 *
 * Building an in-panel input mode instead would mean a second implementation of the composer's key
 * handling, which is the ceiling this deliberately accepts.
 *
 * @param {{
 *   session: any,
 *   output: any,
 *   hook?: { setEnabled?: (on: boolean) => void } | null,
 *   onRepaint: () => void,
 *   onReset: () => void,
 * }} options
 */
export function createPanelSuspension({ session, output, hook = null, onRepaint, onReset }) {
  let savedSink = null;
  let suspended = false;

  const suspend = () => {
    if (suspended) return;
    suspended = true;
    if (session?.streamSink) {
      savedSink = session.streamSink;
      delete session.streamSink;
    }
    hook?.setEnabled?.(false);
    disableMouse(output);
    leaveScreen(output);
  };

  const resume = () => {
    if (!suspended) return;
    suspended = false;
    enterScreen(output);
    enableMouse(output);
    hook?.setEnabled?.(true);
    if (savedSink) {
      session.streamSink = savedSink;
      savedSink = null;
    }
    onReset();
    onRepaint();
  };

  return { suspend, resume, isSuspended: () => suspended };
}
