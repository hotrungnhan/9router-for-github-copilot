import * as vscode from 'vscode';
import { renderStatusBar } from './statusBarRenderer';
import { StatusSnapshot } from './statusSnapshot';
import { renderStatusTooltipHtml, TOOLTIP_COMMANDS } from './statusTooltip';

/** Renders the bar and its tooltip from the same connection snapshot. */
export class StatusBarManager {
  constructor(
    private readonly item: vscode.StatusBarItem,
    private readonly getSnapshot: () => StatusSnapshot
  ) {
    this.refresh();
  }

  refresh(): void {
    const snapshot = this.getSnapshot();
    this.item.text = renderStatusBar(snapshot);
    const tooltip = new vscode.MarkdownString(renderStatusTooltipHtml(snapshot));
    tooltip.isTrusted = { enabledCommands: Object.values(TOOLTIP_COMMANDS) };
    tooltip.supportThemeIcons = true;
    tooltip.supportHtml = true;
    this.item.tooltip = tooltip;
  }
}
