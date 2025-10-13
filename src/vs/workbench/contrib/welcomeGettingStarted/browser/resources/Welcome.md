# Welcome to Erdos

Erdos is your secure, AI-native IDE built for data science. This short guide will help you get started!

## Quick Setup
- [Open the Erdos AI pane](command:workbench.action.toggleErdosAi), configure your key in [Erdos AI Settings](command:erdos.ai.openSettings.viewTitle), and [start a new conversation](command:erdos.ai.newConversation) (click the back arrow).
- Set your working directory in the [Explorer pane](command:workbench.view.explorer) by choosing a folder or cloning a repo.
- [Open the Console view](command:workbench.panel.erdosConsole.focus) and [start a new Python/R session](command:erdos.languageRuntime.startNewSession).
- Explore the [plots pane](command:workbench.action.erdosPlots.openView), the [help pane](command:workbench.action.erdosHelp.showHome), and the [databases pane](command:erdosDatabaseClient).

## 1. Configure Erdos AI
- [Open the Erdos AI pane](command:workbench.action.toggleErdosAi) from the brain icon in the left sidebar, via the Command Palette, or with `⌘B` on macOS.
- Click the gear icon (top-right of the AI pane) to open [Erdos AI Settings](command:erdos.ai.openSettings.viewTitle).
- Choose a sign-in method: use the in-app **Sign in / Sign up** option and complete the browser flow, visit https://www.lotas.ai/account to paste your Lotas API key, or scroll to the bottom of Settings to configure your own OpenAI or Anthropic API key (BYOK).
- Click the **+** button (top-right) to [start a new conversation](command:erdos.ai.newConversation) (press the back arrow).
- The clock icon (top-right of Erdos AI pane) lets you view your chat history.
- The "@ Add context" button (bottom bar) lets you attach files, directories, documentation, or previous chats as context so the AI can use them to fulfill your request.
- The mode toggle (bottom-right) lets you switch between **Agent** (coding and file edits) and **Ask** (questions and exploration).
- The plot icon (bottom-left) lets you attach plots so the AI knows to reference them.

## 2. Launch Python and R sessions
- [Start a new session](command:erdos.languageRuntime.startNewSession) with `Language Runtime: Start New Session`, or [open the Console view](command:workbench.panel.erdosConsole.focus) and click the + icon.
- Attach notebooks or scripts to existing sessions from the session dropdown in the console header. ([Open Console view](command:workbench.panel.erdosConsole.focus))
- [Restart](command:workbench.action.erdosConsole.restartSession) or [Duplicate](command:erdos.languageRuntime.duplicateSession) sessions from the console title bar when you need a clean state.

## 3. Explore essential panes
- [Open the Plots pane](command:workbench.action.erdosPlots.openView) to visualize plots, copy to clipboard, or export images.
- [Open the Help pane](command:workbench.action.erdosHelp.showHome) to browse Python libraries and R package documentation.
- Open the [Databases pane](command:erdosDatabaseClient) to connect to SQL, MongoDB, and more to browse the schema, run queries, and save history. ([Add Connection](command:erdos.database.addConnection) • [New Query](command:erdos.database.newQuery) • [Query History](command:erdos.database.openHistory))

## 4. Customize your workspace
- Visit **Preferences → Settings** and search for `erdos` to tune language runtimes, AI defaults, and security. ([Open Settings](command:workbench.action.openSettings?%5B%7B%22query%22%3A%22erdos%22%7D%5D))
- Switch UI and editor themes via `View: Color Theme` to match your environment. ([Browse Color Themes](command:workbench.action.selectTheme))
- Install language or domain extensions from the Extensions view for linting, debuggers, and integrations. ([Open Extensions](command:workbench.view.extensions))

## 5. Next steps
- Join the Lotas community forum at <https://community.lotas.ai/>. We welcome your feedback!

Enjoy building with Erdos!

## Reopen This Guide
- Open the Welcome page (Help → Welcome) and select the card titled **Get started with Erdos AI Assistant**, or run the Command Palette and search for "Welcome" to open the Welcome page.
