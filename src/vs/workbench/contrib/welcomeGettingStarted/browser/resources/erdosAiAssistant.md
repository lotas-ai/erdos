# Get Started with the Erdos AI Assistant

Welcome to your AI co-pilot for data science. This short guide walks you through the essential steps to enable Erdos AI, establish a secure workspace, and start shipping analyses faster.

## 1. Open the Erdos AI pane
- Use the **Get started with Erdos AI** button on the Welcome page or run `Erdos AI: New Conversation` from the Command Palette (`⇧⌘P` / `Ctrl+Shift+P`).
- The pane opens in the sidebar. If you accidentally close it later, run `View: Toggle Erdos AI` or `Erdos AI: New Conversation` again.

## 2. Sign in or create an account
- In the Erdos AI pane, select **Configure Chat…** (gear icon) to open the settings.
- Choose **Sign in** to connect an existing account or **Create one** to start a new subscription.
- Review the data handling controls (workspace retention, model tier, telemetry) and keep the toggle defaults unless your organization requires stricter policies.

## 3. Choose your workspace context
- Pick a project folder or workspace before chatting so the assistant can index notebooks, scripts, and data connections.
- If you need to work without local files, select **New Conversation** and choose **Ad-hoc session** to chat against a blank workspace.

## 4. Start a conversation
- Click **New Conversation** or press `⌘Enter` / `Ctrl+Enter` in the message input to send your first question.
- Attach files or notebook cells with the `+` button to give the assistant additional context.
- Use the **Terminal** and **File** quick actions in the context bar to run generated code automatically.

## 5. Link to runtimes and sessions
- When prompted, choose an existing Python or R session or start a new one. This lets Erdos AI execute code safely in your environment.
- You can manage sessions at any time with `Interpreter: Start New Interpreter Session` or `Interpreter: Select Interpreter Session`.

## 6. Explore the companion panes
- **Plots** pane: review rendered figures and export them via the toolbar actions.
- **Help** pane: search language docs the assistant references.
- **Databases** pane: add or browse connections for SQL, MongoDB, or Elasticsearch.

## 7. Keep things secure
- Never paste secrets directly into chat; instead, store credentials in your runtime environment or connection profiles.
- Use the **Data Usage** section in Erdos AI settings to disable dataset uploads for sensitive projects.

Need more help? Visit the Erdos docs at <https://docs.erdos.dev/assistant> or run `Help: Show Welcome` to reopen this page later.
