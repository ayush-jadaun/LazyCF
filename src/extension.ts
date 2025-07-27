import * as vscode from "vscode";
import { CodeforcesClient } from "./codeforcesClient.js";
import { ProblemProvider } from "./problemProvider.js";

let codeforcesClient: CodeforcesClient;
let problemProvider: ProblemProvider;

export function activate(context: vscode.ExtensionContext) {
  console.log("LazyCF extension is now active!");

  codeforcesClient = new CodeforcesClient(context);
  problemProvider = new ProblemProvider();

  // Register all commands
  const commands = [
    // Login command
    vscode.commands.registerCommand("lazycf.login", async () => {
      const handle = await vscode.window.showInputBox({
        prompt: "Enter your Codeforces handle",
        placeHolder: "username",
        ignoreFocusOut: true,
      });

      if (!handle) {
        return;
      }

   
      // In the existing login command, after getting the handle:
      const password = await vscode.window.showInputBox({
        prompt:
          "Enter your Codeforces password (or leave empty for Google/social login)",
        password: true,
        placeHolder: "password (optional)",
        ignoreFocusOut: true,
      });

      if (handle && !password) {
        // Trigger browser login for Google users
        await codeforcesClient.loginWithBrowser(handle);
      } 

      if (handle && password) {
        try {
          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: "Logging in to Codeforces...",
              cancellable: false,
            },
            async () => {
              await codeforcesClient.login(handle, password);
            }
          );

          vscode.window.showInformationMessage(
            "✅ Successfully logged in to Codeforces!"
          );
        } catch (error) {
          vscode.window.showErrorMessage(`❌ Login failed: ${error}`);
        }
      }
    }),

    // Logout command
    vscode.commands.registerCommand("lazycf.logout", async () => {
      try {
        await codeforcesClient.logout();
        vscode.window.showInformationMessage("✅ Successfully logged out!");
      } catch (error) {
        vscode.window.showErrorMessage(`❌ Logout failed: ${error}`);
      }
    }),

    // Check login status
    vscode.commands.registerCommand("lazycf.checkLogin", async () => {
      try {
        const isLoggedIn = await codeforcesClient.isUserLoggedIn();
        if (isLoggedIn) {
          vscode.window.showInformationMessage(
            "✅ You are logged in to Codeforces"
          );
        } else {
          vscode.window.showWarningMessage(
            "⚠️ You are not logged in to Codeforces"
          );
        }
      } catch (error) {
        vscode.window.showErrorMessage(
          `❌ Failed to check login status: ${error}`
        );
      }
    }),

    // Fetch specific problem
    vscode.commands.registerCommand("lazycf.fetchProblem", async () => {
      const contestId = await vscode.window.showInputBox({
        prompt: "Enter contest ID",
        placeHolder: "1234",
        ignoreFocusOut: true,
      });

      if (!contestId) {
        return;
      }

      const problemIndex = await vscode.window.showInputBox({
        prompt: "Enter problem index (A, B, C, etc.)",
        placeHolder: "A",
        ignoreFocusOut: true,
      });

      if (!problemIndex) {
        return;
      }

      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Fetching problem ${contestId}${problemIndex.toUpperCase()}...`,
            cancellable: false,
          },
          async () => {
            const problem = await codeforcesClient.fetchProblem(
              contestId,
              problemIndex.toUpperCase()
            );
            await problemProvider.displayProblem(problem);
          }
        );

        vscode.window.showInformationMessage(
          `✅ Problem ${contestId}${problemIndex.toUpperCase()} fetched successfully!`
        );
      } catch (error) {
        vscode.window.showErrorMessage(`❌ Failed to fetch problem: ${error}`);
      }
    }),

    // Search problems
    vscode.commands.registerCommand("lazycf.searchProblems", async () => {
      const query = await vscode.window.showInputBox({
        prompt: "Search problems by tag or title",
        placeHolder: "dp, binary search, graph, etc.",
        ignoreFocusOut: true,
      });

      if (!query) {
        return;
      }

      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "Searching problems...",
            cancellable: false,
          },
          async () => {
            const problems = await codeforcesClient.searchProblems(query);
            const selectedProblem = await problemProvider.showProblemQuickPick(
              problems
            );

            if (selectedProblem) {
              const problem = await codeforcesClient.fetchProblem(
                selectedProblem.contestId.toString(),
                selectedProblem.index
              );
              await problemProvider.displayProblem(problem);
            }
          }
        );
      } catch (error) {
        vscode.window.showErrorMessage(`❌ Search failed: ${error}`);
      }
    }),

    // Submit solution
    vscode.commands.registerCommand("lazycf.submitSolution", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage(
          "❌ No active editor found. Please open a solution file."
        );
        return;
      }

      // Auto-save if enabled
      const config = vscode.workspace.getConfiguration("lazycf");
      if (config.get("autoSave", true)) {
        await editor.document.save();
      }

      const contestId = await vscode.window.showInputBox({
        prompt: "Enter contest ID",
        placeHolder: "1234",
        ignoreFocusOut: true,
      });

      if (!contestId) {
        return;
      }

      const problemIndex = await vscode.window.showInputBox({
        prompt: "Enter problem index (A, B, C, etc.)",
        placeHolder: "A",
        ignoreFocusOut: true,
      });

      if (!problemIndex) {
        return;
      }

      try {
        const code = editor.document.getText();
        const language = getLanguageFromExtension(editor.document.fileName);

        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Submitting solution for ${contestId}${problemIndex.toUpperCase()}...`,
            cancellable: false,
          },
          async () => {
            const submissionId = await codeforcesClient.submitSolution(
              contestId,
              problemIndex.toUpperCase(),
              code,
              language
            );

            const result = await vscode.window.showInformationMessage(
              `✅ Solution submitted successfully! Submission ID: ${submissionId}`,
              "View Submissions"
            );

            if (result === "View Submissions") {
              await vscode.commands.executeCommand("lazycf.viewSubmissions");
            }

            // Check submission status after a delay
            setTimeout(async () => {
              try {
                const status = await codeforcesClient.getSubmissionStatus(
                  submissionId
                );
                if (config.get("showNotifications", true)) {
                  vscode.window.showInformationMessage(
                    `📊 Submission Status: ${status}`
                  );
                }
              } catch (error) {
                console.error("Failed to get submission status:", error);
              }
            }, 5000);
          }
        );
      } catch (error) {
        vscode.window.showErrorMessage(`❌ Submission failed: ${error}`);
      }
    }),

    // View submissions
    vscode.commands.registerCommand("lazycf.viewSubmissions", async () => {
      try {
        const submissions = await codeforcesClient.getRecentSubmissions();
        await problemProvider.showSubmissions(submissions);
      } catch (error) {
        vscode.window.showErrorMessage(
          `❌ Failed to fetch submissions: ${error}`
        );
      }
    }),

    // Fetch contest problems
    vscode.commands.registerCommand("lazycf.fetchContest", async () => {
      const contestId = await vscode.window.showInputBox({
        prompt: "Enter contest ID to fetch all problems",
        placeHolder: "1234",
        ignoreFocusOut: true,
      });

      if (!contestId) {
        return;
      }

      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Fetching contest ${contestId} problems...`,
            cancellable: false,
          },
          async () => {
            const problems = await codeforcesClient.fetchContestProblems(
              contestId
            );
            await problemProvider.displayContestProblems(problems, contestId);
          }
        );

        vscode.window.showInformationMessage(
          `✅ Contest ${contestId} problems fetched successfully!`
        );
      } catch (error) {
        vscode.window.showErrorMessage(
          `❌ Failed to fetch contest problems: ${error}`
        );
      }
    }),

    // Hello World (keep your original command)
    vscode.commands.registerCommand("Lazy.helloWorld", () => {
      vscode.window.showInformationMessage("Hello World from LazyCF!");
    }),
  ];

  context.subscriptions.push(...commands);
}

function getLanguageFromExtension(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase();
  const languageMap: { [key: string]: string } = {
    cpp: "GNU G++17 7.3.0",
    cc: "GNU G++17 7.3.0",
    cxx: "GNU G++17 7.3.0",
    c: "GNU GCC C11 5.1.0",
    py: "Python 3.8.10",
    py3: "Python 3.8.10",
    java: "Java 11.0.6",
    js: "Node.js 12.16.3",
    ts: "Node.js 12.16.3",
  };

  return languageMap[ext || "cpp"] || "GNU G++17 7.3.0";
}

export function deactivate(): void {
  console.log("LazyCF extension deactivated");
}
