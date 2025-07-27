import * as vscode from "vscode";
import axios, { AxiosInstance } from "axios";
import * as cheerio from "cheerio";
import { CookieJar } from "tough-cookie";

export interface Problem {
  contestId: number;
  index: string;
  name: string;
  type: string;
  points?: number;
  rating?: number;
  tags: string[];
  statement: string;
  inputFormat: string;
  outputFormat: string;
  examples: Array<{ input: string; output: string }>;
}

export interface Submission {
  id: string;
  problemName: string;
  verdict: string;
  timeConsumed: string;
  memoryConsumed: string;
}

export class CodeforcesClient {
  private httpClient: AxiosInstance;
  private cookieJar: CookieJar;
  private isLoggedIn: boolean = false;
  private context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.cookieJar = new CookieJar();
    this.httpClient = axios.create({
      baseURL: "https://codeforces.com",
      timeout: 30000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    // Add request interceptor to handle cookies
    this.httpClient.interceptors.request.use(async (config) => {
      const baseUrl = config.baseURL || "https://codeforces.com";
      const url = config.url || "";
      const cookies = await this.cookieJar.getCookieString(baseUrl + url);
      if (cookies) {
        config.headers.Cookie = cookies;
      }
      return config;
    });

    // Add response interceptor to store cookies
    this.httpClient.interceptors.response.use(async (response) => {
      const setCookies = response.headers["set-cookie"];
      if (setCookies) {
        const baseUrl = response.config.baseURL || "https://codeforces.com";
        const url = response.config.url || "";
        for (const cookie of setCookies) {
          await this.cookieJar.setCookie(cookie, baseUrl + url);
        }
      }
      return response;
    });
  }

  async login(handle: string, password?: string): Promise<void> {
    try {
      // First, try to restore session from stored cookies
      const storedCookies = await this.context.globalState.get("cf_cookies");
      if (storedCookies) {
        // Restore cookies and verify login
        for (const cookie of storedCookies as string[]) {
          await this.cookieJar.setCookie(cookie, "https://codeforces.com");
        }

        if (await this.verifyLogin(handle)) {
          this.isLoggedIn = true;
          return;
        }
      }

      // If password is not provided, show instructions for manual login
      if (!password) {
        throw new Error(
          "Password not provided. For Google/social login users:\n" +
            "1. Go to Codeforces settings and set a password, OR\n" +
            "2. Use the manual browser login option, OR\n" +
            "3. Use session cookies (see documentation)"
        );
      }

      // Traditional username/password login
      await this.performPasswordLogin(handle, password);
    } catch (error) {
      throw new Error(`Login failed: ${error}`);
    }
  }

  private async performPasswordLogin(
    handle: string,
    password: string
  ): Promise<void> {
    // Get login page to extract CSRF token
    const loginPageResponse = await this.httpClient.get("/enter");
    const $ = cheerio.load(loginPageResponse.data);
    const csrfToken = $('input[name="csrf_token"]').val() as string;

    if (!csrfToken) {
      throw new Error("Could not find CSRF token");
    }

    // Submit login form
    const loginData = new URLSearchParams({
      csrf_token: csrfToken,
      action: "enter",
      ftaa: "",
      bfaa: "",
      handleOrEmail: handle,
      password: password,
      remember: "on",
    });

    const loginResponse = await this.httpClient.post("/enter", loginData, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: "https://codeforces.com/enter",
      },
      maxRedirects: 0,
      validateStatus: (status) => status < 400,
    });

    // Verify login was successful
    if (await this.verifyLogin(handle)) {
      this.isLoggedIn = true;
      // Store credentials and cookies securely
      await this.context.secrets.store("cf_handle", handle);
      await this.context.secrets.store("cf_password", password);
      await this.storeCookies();
    } else {
      throw new Error("Login verification failed");
    }
  }

  private async verifyLogin(handle: string): Promise<boolean> {
    try {
      const profileResponse = await this.httpClient.get("/profile/" + handle);
      const $ = cheerio.load(profileResponse.data);

      // Check if we can see user-specific elements (like settings link)
      const isLoggedIn =
        $(".lang-chooser").length > 0 ||
        $("a[href='/settings/general']").length > 0;

      return profileResponse.status === 200 && isLoggedIn;
    } catch {
      return false;
    }
  }

  private async storeCookies(): Promise<void> {
    try {
      const cookies = await this.cookieJar.getCookies("https://codeforces.com");
      const cookieStrings = cookies.map((cookie) => cookie.toString());
      await this.context.globalState.update("cf_cookies", cookieStrings);
    } catch (error) {
      console.warn("Failed to store cookies:", error);
    }
  }

  async fetchProblem(
    contestId: string,
    problemIndex: string
  ): Promise<Problem> {
    try {
      const url = `/contest/${contestId}/problem/${problemIndex}`;
      const response = await this.httpClient.get(url);
      const $ = cheerio.load(response.data);

      const problem: Problem = {
        contestId: parseInt(contestId),
        index: problemIndex,
        name: $(".problem-statement .title")
          .text()
          .trim()
          .replace(/^[A-Z]\.\s*/, ""),
        type: "PROGRAMMING",
        tags: [],
        statement: "",
        inputFormat: "",
        outputFormat: "",
        examples: [],
      };

      // Extract problem statement
      const statementDiv = $(".problem-statement .header + div").first();
      problem.statement = statementDiv.text().trim();

      // Extract input format
      const inputFormatDiv = $(".input-specification div").first();
      problem.inputFormat = inputFormatDiv.text().trim();

      // Extract output format
      const outputFormatDiv = $(".output-specification div").first();
      problem.outputFormat = outputFormatDiv.text().trim();

      // Extract examples
      $(".sample-test .input, .sample-test .output").each((i, element) => {
        const isInput = $(element).hasClass("input");
        const content = $(element).find("pre").text().trim();

        if (isInput) {
          problem.examples.push({ input: content, output: "" });
        } else if (problem.examples.length > 0) {
          problem.examples[problem.examples.length - 1].output = content;
        }
      });

      // Extract tags from API if available
      try {
        const apiResponse = await this.httpClient.get(
          "/api/contest.standings",
          {
            params: {
              contestId: contestId,
              from: 1,
              count: 1,
            },
          }
        );

        if (apiResponse.data.status === "OK") {
          const problems = apiResponse.data.result.problems;
          const apiProblem = problems.find(
            (p: any) => p.index === problemIndex
          );
          if (apiProblem) {
            problem.tags = apiProblem.tags || [];
            problem.rating = apiProblem.rating;
          }
        }
      } catch (apiError) {
        console.warn("Could not fetch problem tags from API:", apiError);
      }

      return problem;
    } catch (error) {
      throw new Error(`Failed to fetch problem: ${error}`);
    }
  }

  async searchProblems(query: string): Promise<Problem[]> {
    try {
      // Use the problemset API to search for problems
      const response = await this.httpClient.get("/api/problemset.problems");

      if (response.data.status !== "OK") {
        throw new Error("API request failed");
      }

      const problems = response.data.result.problems;
      const filteredProblems = problems
        .filter((problem: any) => {
          const matchesTitle = problem.name
            .toLowerCase()
            .includes(query.toLowerCase());
          const matchesTags = problem.tags.some((tag: string) =>
            tag.toLowerCase().includes(query.toLowerCase())
          );
          return matchesTitle || matchesTags;
        })
        .slice(0, 50); // Limit results

      return filteredProblems.map((p: any) => ({
        contestId: p.contestId,
        index: p.index,
        name: p.name,
        type: p.type,
        rating: p.rating,
        tags: p.tags,
        statement: "",
        inputFormat: "",
        outputFormat: "",
        examples: [],
      }));
    } catch (error) {
      throw new Error(`Search failed: ${error}`);
    }
  }

  async submitSolution(
    contestId: string,
    problemIndex: string,
    code: string,
    language: string
  ): Promise<string> {
    if (!this.isLoggedIn) {
      throw new Error("Not logged in. Please login first.");
    }

    try {
      // Get submit page to extract CSRF token
      const submitPageUrl = `/contest/${contestId}/submit`;
      const submitPageResponse = await this.httpClient.get(submitPageUrl);
      const $ = cheerio.load(submitPageResponse.data);
      const csrfToken = $('input[name="csrf_token"]').val() as string;

      if (!csrfToken) {
        throw new Error("Could not find CSRF token on submit page");
      }

      // Prepare submission data
      const submissionData = new URLSearchParams({
        csrf_token: csrfToken,
        action: "submitSolutionFormSubmitted",
        submittedProblemIndex: problemIndex,
        programTypeId: this.getLanguageId(language),
        source: code,
        tabSize: "4",
        sourceFile: "",
      });

      // Submit solution
      const submitResponse = await this.httpClient.post(
        submitPageUrl,
        submissionData,
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Referer: `https://codeforces.com${submitPageUrl}`,
          },
        }
      );

      // Check if submission was successful by looking for redirect or success indicators
      if (submitResponse.status === 200) {
        // Try to extract submission ID from the response or redirect
        const submissionId = this.extractSubmissionId(submitResponse.data);
        return submissionId || "unknown";
      } else {
        throw new Error("Submission request failed");
      }
    } catch (error) {
      throw new Error(`Submission failed: ${error}`);
    }
  }

  /**
   * Get the status of a specific submission
   */
  async getSubmissionStatus(submissionId: string): Promise<string> {
    if (!this.isLoggedIn) {
      throw new Error("Not logged in. Please login first.");
    }

    try {
      // Try to get submission status from the submissions page
      const response = await this.httpClient.get("/submissions");
      const $ = cheerio.load(response.data);

      // Look for the specific submission in the table
      let status = "Unknown";
      $("table.status-frame-datatable tr").each((index, row) => {
        if (index === 0){ return; }// Skip header

        const cells = $(row).find("td");
        if (cells.length >= 6) {
          const currentSubmissionId = $(cells[0]).text().trim();
          if (currentSubmissionId === submissionId) {
            status = $(cells[5]).text().trim();
            return false; // Break the loop
          }
        }
      });

      // If not found in recent submissions, try the API approach
      if (status === "Unknown") {
        try {
          const handle = await this.context.secrets.get("cf_handle");
          if (handle) {
            const apiResponse = await this.httpClient.get("/api/user.status", {
              params: {
                handle: handle,
                from: 1,
                count: 50,
              },
            });

            if (apiResponse.data.status === "OK") {
              const submissions = apiResponse.data.result;
              const submission = submissions.find(
                (s: any) => s.id.toString() === submissionId
              );
              if (submission) {
                status = submission.verdict || "Unknown";
              }
            }
          }
        } catch (apiError) {
          console.warn("Could not fetch submission status from API:", apiError);
        }
      }

      return status;
    } catch (error) {
      throw new Error(`Failed to get submission status: ${error}`);
    }
  }

  /**
   * Alternative login method for users with Google/social login
   * Opens browser for manual login and captures session
   */
  async loginWithBrowser(handle: string): Promise<void> {
    try {
      const loginUrl = "https://codeforces.com/enter";

      // Show instructions to user
      const result = await vscode.window.showInformationMessage(
        `Please login to Codeforces in your browser, then return here.`,
        { modal: true },
        "Open Browser",
        "I've logged in"
      );

      if (result === "Open Browser") {
        await vscode.env.openExternal(vscode.Uri.parse(loginUrl));

        await vscode.window.showInformationMessage(
          "After logging in, click 'I've logged in' to continue.",
          "I've logged in"
        );
      }

      // Prompt user to provide session cookies
      const cookieInput = await vscode.window.showInputBox({
        prompt:
          "Paste your session cookies (or press Enter to try automatic detection)",
        placeHolder: "JSESSIONID=...; rcpc=...",
        password: true,
      });

      if (cookieInput) {
        await this.loginWithCookies(handle, cookieInput);
      } else {
        // Try to detect if user is logged in by making a test request
        if (await this.verifyLogin(handle)) {
          this.isLoggedIn = true;
          await this.storeCookies();
        } else {
          throw new Error(
            "Could not verify login. Please provide session cookies."
          );
        }
      }
    } catch (error) {
      throw new Error(`Browser login failed: ${error}`);
    }
  }

  /**
   * Login using session cookies (for users who can't use password)
   */
  async loginWithCookies(handle: string, cookieString: string): Promise<void> {
    try {
      // Parse and set cookies
      const cookies = cookieString.split(";").map((c) => c.trim());
      for (const cookie of cookies) {
        if (cookie) {
          await this.cookieJar.setCookie(cookie, "https://codeforces.com");
        }
      }

      // Verify login works
      if (await this.verifyLogin(handle)) {
        this.isLoggedIn = true;
        await this.context.secrets.store("cf_handle", handle);
        await this.storeCookies();
      } else {
        throw new Error("Invalid session cookies or session expired");
      }
    } catch (error) {
      throw new Error(`Cookie login failed: ${error}`);
    }
  }

  /**
   * Check if user is currently logged in
   */
  async isUserLoggedIn(): Promise<boolean> {
    if (!this.isLoggedIn) {
      return false;
    }

    // Try to get handle from stored secrets
    const handle = await this.context.secrets.get("cf_handle");
    if (!handle) {
      return false;
    }

    return await this.verifyLogin(handle);
  }

  /**
   * Logout and clear stored credentials
   */
  async logout(): Promise<void> {
    this.isLoggedIn = false;
    await this.context.secrets.delete("cf_handle");
    await this.context.secrets.delete("cf_password");
    await this.context.globalState.update("cf_cookies", undefined);

    // Clear cookie jar
    const cookies = await this.cookieJar.getCookies("https://codeforces.com");
    for (const cookie of cookies) {
      await this.cookieJar.setCookie(
        `${cookie.key}=; expires=Thu, 01 Jan 1970 00:00:00 GMT`,
        "https://codeforces.com"
      );
    }
  }

  private getLanguageId(language: string): string {
    const languageIds: { [key: string]: string } = {
      "GNU G++17 7.3.0": "54",
      "GNU G++14 6.4.0": "50",
      "GNU G++11 5.1.0": "42",
      "GNU GCC C11 5.1.0": "43",
      "Python 3.8.10": "31",
      "Python 2.7.18": "7",
      "Java 11.0.6": "60",
      "Java 8": "36",
      "Node.js 12.16.3": "55",
    };

    return languageIds[language] || "54"; // Default to G++17
  }

  async getRecentSubmissions(): Promise<Submission[]> {
    if (!this.isLoggedIn) {
      throw new Error("Not logged in. Please login first.");
    }

    try {
      const response = await this.httpClient.get("/submissions");
      const $ = cheerio.load(response.data);
      const submissions: Submission[] = [];

      // Parse submissions table
      $("table.status-frame-datatable tr").each((index, row) => {
        if (index === 0) {
          return; // Skip header
        }

        const cells = $(row).find("td");
        if (cells.length >= 6) {
          const submissionId = $(cells[0]).text().trim();
          const problemInfo = $(cells[3]).find("a").text().trim();
          const verdict = $(cells[5]).text().trim();
          const time = $(cells[4]).text().trim();

          if (submissionId && problemInfo) {
            submissions.push({
              id: submissionId,
              problemName: problemInfo,
              verdict: verdict || "Unknown",
              timeConsumed: time || "N/A",
              memoryConsumed: "N/A",
            });
          }
        }
      });

      return submissions.slice(0, 20); // Return last 20 submissions
    } catch (error) {
      throw new Error(`Failed to fetch submissions: ${error}`);
    }
  }

  async fetchContestProblems(contestId: string): Promise<Problem[]> {
    try {
      // First try to get problems from the contest page
      const contestUrl = `/contest/${contestId}`;
      const response = await this.httpClient.get(contestUrl);
      const $ = cheerio.load(response.data);
      const problems: Problem[] = [];

      // Parse problems table
      $(".problems tr").each((index, row) => {
        if (index === 0) {
          return; // Skip header
        }

        const cells = $(row).find("td");
        if (cells.length >= 2) {
          const problemIndex = $(cells[0]).text().trim();
          const problemName = $(cells[1]).find("a").text().trim();

          if (problemIndex && problemName) {
            problems.push({
              contestId: parseInt(contestId),
              index: problemIndex,
              name: problemName,
              type: "PROGRAMMING",
              tags: [],
              statement: "",
              inputFormat: "",
              outputFormat: "",
              examples: [],
            });
          }
        }
      });

      // If no problems found, try API
      if (problems.length === 0) {
        try {
          const apiResponse = await this.httpClient.get(
            "/api/contest.standings",
            {
              params: {
                contestId: contestId,
                from: 1,
                count: 1,
              },
            }
          );

          if (apiResponse.data.status === "OK") {
            const apiProblems = apiResponse.data.result.problems;
            return apiProblems.map((p: any) => ({
              contestId: p.contestId,
              index: p.index,
              name: p.name,
              type: p.type,
              rating: p.rating,
              tags: p.tags,
              statement: "",
              inputFormat: "",
              outputFormat: "",
              examples: [],
            }));
          }
        } catch (apiError) {
          console.warn("API fallback failed:", apiError);
        }
      }

      return problems;
    } catch (error) {
      throw new Error(`Failed to fetch contest problems: ${error}`);
    }
  }

  private extractSubmissionId(html: string): string | null {
    // Try to extract submission ID from response HTML
    // This would need to be implemented based on Codeforces' actual response format
    const match = html.match(/submission\/(\d+)/);
    return match ? match[1] : null;
  }
}
