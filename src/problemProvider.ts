import * as vscode from "vscode";
import { Problem, Submission } from "./codeforcesClient.js";

export class ProblemProvider {
  async displayProblem(problem: Problem): Promise<void> {
    // Create a new untitled document with problem details
    const problemContent = this.formatProblemContent(problem);

    const doc = await vscode.workspace.openTextDocument({
      content: problemContent,
      language: "markdown",
    });

    await vscode.window.showTextDocument(doc);

    // Also create a solution template file
    await this.createSolutionTemplate(problem);
  }

  async showProblemQuickPick(
    problems: Problem[]
  ): Promise<Problem | undefined> {
    const items = problems.map((problem) => ({
      label: `${problem.contestId}${problem.index}: ${problem.name}`,
      description: `Rating: ${
        problem.rating || "N/A"
      } | Tags: ${problem.tags.join(", ")}`,
      problem: problem,
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: "Select a problem to fetch",
      matchOnDescription: true,
    });

    return selected?.problem;
  }

  private formatProblemContent(problem: Problem): string {
    let content = `# ${problem.contestId}${problem.index}: ${problem.name}\n\n`;

    if (problem.rating) {
      content += `**Rating:** ${problem.rating}\n\n`;
    }

    if (problem.tags.length > 0) {
      content += `**Tags:** ${problem.tags.join(", ")}\n\n`;
    }

    content += `## Problem Statement\n\n${problem.statement}\n\n`;

    if (problem.inputFormat) {
      content += `## Input Format\n\n${problem.inputFormat}\n\n`;
    }

    if (problem.outputFormat) {
      content += `## Output Format\n\n${problem.outputFormat}\n\n`;
    }

    if (problem.examples.length > 0) {
      content += `## Examples\n\n`;
      problem.examples.forEach((example, index) => {
        content += `### Example ${index + 1}\n\n`;
        content += `**Input:**\n\`\`\`\n${example.input}\n\`\`\`\n\n`;
        content += `**Output:**\n\`\`\`\n${example.output}\n\`\`\`\n\n`;
      });
    }

    content += `---\n\n`;
    content += `**Contest Link:** [${problem.contestId}${problem.index}](https://codeforces.com/contest/${problem.contestId}/problem/${problem.index})\n\n`;

    return content;
  }

  async showSubmissions(submissions: Submission[]): Promise<void> {
    if (submissions.length === 0) {
      vscode.window.showInformationMessage("No recent submissions found.");
      return;
    }

    const submissionContent = this.formatSubmissionsContent(submissions);

    const doc = await vscode.workspace.openTextDocument({
      content: submissionContent,
      language: "markdown",
    });

    await vscode.window.showTextDocument(doc);
  }

  async displayContestProblems(
    problems: Problem[],
    contestId: string
  ): Promise<void> {
    if (problems.length === 0) {
      vscode.window.showInformationMessage(
        `No problems found for contest ${contestId}.`
      );
      return;
    }

    // Create overview document
    const overviewContent = this.formatContestOverview(problems, contestId);

    const overviewDoc = await vscode.workspace.openTextDocument({
      content: overviewContent,
      language: "markdown",
    });

    await vscode.window.showTextDocument(overviewDoc);

    // Create solution templates for all problems
    const selectedProblems = await vscode.window.showQuickPick(
      problems.map((p) => ({
        label: `${p.index}: ${p.name}`,
        description: p.rating ? `Rating: ${p.rating}` : "",
        problem: p,
        picked: true,
      })),
      {
        placeHolder: "Select problems to create solution templates for",
        canPickMany: true,
      }
    );

    if (selectedProblems && selectedProblems.length > 0) {
      for (const item of selectedProblems) {
        await this.createSolutionTemplate(item.problem);
      }
      vscode.window.showInformationMessage(
        `Created solution templates for ${selectedProblems.length} problems.`
      );
    }
  }

  private formatSubmissionsContent(submissions: Submission[]): string {
    let content = "# Recent Submissions\n\n";

    content += "| ID | Problem | Verdict | Time |\n";
    content += "|---|---|---|---|\n";

    submissions.forEach((sub) => {
      const verdictEmoji = this.getVerdictEmoji(sub.verdict);
      content += `| ${sub.id} | ${sub.problemName} | ${verdictEmoji} ${sub.verdict} | ${sub.timeConsumed} |\n`;
    });

    content += "\n---\n\n";
    content += `*Last updated: ${new Date().toLocaleString()}*\n`;

    return content;
  }

  private formatContestOverview(
    problems: Problem[],
    contestId: string
  ): string {
    let content = `# Contest ${contestId} Problems\n\n`;

    content += `**Total Problems**: ${problems.length}\n\n`;

    content += "## Problem List\n\n";
    problems.forEach((problem) => {
      content += `### ${problem.index}: ${problem.name}\n`;
      if (problem.rating) {
        content += `**Rating**: ${problem.rating}\n`;
      }
      if (problem.tags.length > 0) {
        content += `**Tags**: ${problem.tags.join(", ")}\n`;
      }
      content += `**Link**: [Problem ${problem.index}](https://codeforces.com/contest/${problem.contestId}/problem/${problem.index})\n\n`;
    });

    content += "---\n\n";
    content += `**Contest Link**: [Contest ${contestId}](https://codeforces.com/contest/${contestId})\n`;

    return content;
  }

  private getVerdictEmoji(verdict: string): string {
    const verdictMap: { [key: string]: string } = {
      Accepted: "✅",
      "Wrong answer": "❌",
      "Time limit exceeded": "⏰",
      "Memory limit exceeded": "💾",
      "Runtime error": "💥",
      "Compilation error": "🔨",
      Pending: "⏳",
      Running: "🏃",
      Partial: "⚠️",
    };

    for (const [key, emoji] of Object.entries(verdictMap)) {
      if (verdict.toLowerCase().includes(key.toLowerCase())) {
        return emoji;
      }
    }

    return "❓";
  }

  private async createSolutionTemplate(problem: Problem): Promise<void> {
    const config = vscode.workspace.getConfiguration("codeforces");
    const defaultLanguage = config.get<string>("defaultLanguage", "cpp");

    let template = "";
    let fileExtension = "";

    switch (defaultLanguage) {
      case "cpp":
        fileExtension = "cpp";
        template = `#include <bits/stdc++.h>
using namespace std;

int main() {
    ios_base::sync_with_stdio(false);
    cin.tie(NULL);
    
    // Solution for ${problem.contestId}${problem.index}: ${problem.name}
    
    return 0;
}`;
        break;

      case "python":
        fileExtension = "py";
        template = `# Solution for ${problem.contestId}${problem.index}: ${problem.name}

def solve():
    pass

if __name__ == "__main__":
    solve()`;
        break;

      case "java":
        fileExtension = "java";
        template = `import java.util.*;
import java.io.*;

public class Solution {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        
        // Solution for ${problem.contestId}${problem.index}: ${problem.name}
        
        sc.close();
    }
}`;
        break;

      default:
        fileExtension = "txt";
        template = `// Solution for ${problem.contestId}${problem.index}: ${problem.name}`;
    }

    const doc = await vscode.workspace.openTextDocument({
      content: template,
      language: defaultLanguage === "python" ? "python" : defaultLanguage,
    });

    // Suggest a filename
    const fileName = `${problem.contestId}${problem.index}_${problem.name
      .replace(/[^a-zA-Z0-9]/g, "_")
      .toLowerCase()}.${fileExtension}`;

    await vscode.window.showTextDocument(doc);

    // Show save dialog with suggested filename
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(fileName),
      filters: {
        "Source Files": [fileExtension],
      },
    });

    if (uri) {
      await vscode.workspace.fs.writeFile(uri, Buffer.from(template, "utf8"));
      const savedDoc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(savedDoc);
    }
  }
}
