import {
  ExtensionContext,
  workspace,
  TextEditor,
  window,
  commands,
  WorkspaceConfiguration,
  QuickPickItem,
  SnippetString,
} from "vscode";
import { promises } from "fs";
import { join } from "path";

interface QuickPickItemWithCode extends QuickPickItem {
  code: string;
}

const parseExtension = (filename: string): string | undefined => {
  return /\.([^.]*)$/.exec(filename)?.[1];
};

const parseBrief = (code: string): string | undefined => {
  return /@brief (.*)\n/m.exec(code)?.[1];
};

export async function activate(context: ExtensionContext) {
  const pkg: string = "compro-snippet-from-file";
  const SNIPPETPATH: string = "<SNIPPETPATH>";

  // Load configurations
  const config: WorkspaceConfiguration = workspace.getConfiguration(pkg);
  const snippetDirectory: string = config.get("snippetDirectory", "");
  if (snippetDirectory === "") {
    window.showErrorMessage(
      `Failed to load snippets. Please specify '${pkg}.snippetDirectory' in the User Settings.`
    );
    return;
  }
  const addRegion: boolean = config.get("addRegion", false);
  const beginRegion: { [key: string]: string } = config.get("beginRegion", {});
  const endRegion: { [key: string]: string } = config.get("endRegion", {});
  const addRegionExcept: Array<string> = config.get("addRegionExcept", []);
  const ignoringDirectory: Array<string> = config.get("ignoringDirectory", []);
  const snippetExtensions: Array<string> = config.get("snippetExtensions", []);

  // Load a snippet
  const loadSnippetCode = async (dir: string): Promise<string | undefined> => {
    const absPath: string = join(snippetDirectory, dir);
    try {
      let code: string = await promises.readFile(absPath, "utf8");
      if (code.slice(-1) !== "\n") {
        code += "\n";
      }
      return code;
    } catch (err) {
      window.showErrorMessage(`Failed to load the snippet: ${dir} (${err})`);
      return undefined;
    }
  };

  // Traverse through all children
  const retrieveQuickPicks = async (
    dir: string,
    quickPicks: Array<QuickPickItemWithCode>
  ): Promise<Array<QuickPickItemWithCode>> => {
    // Ignore
    if (ignoringDirectory.includes(dir)) {
      return quickPicks;
    }

    const dirents = await promises.readdir(join(snippetDirectory, dir), {
      withFileTypes: true,
    });
    const nextDirectories: Array<string> = [];
    for (const dirent of dirents) {
      if (dirent.isDirectory()) {
        nextDirectories.push(join(dir, dirent.name));
      }
      if (
        dirent.isFile() &&
        (snippetExtensions.length === 0 ||
          snippetExtensions.includes(parseExtension(dirent.name) ?? ""))
      ) {
        const codePath: string = join(dir, dirent.name);
        const code: string = (await loadSnippetCode(codePath)) ?? "";
        quickPicks.push({
          label: parseBrief(code) ?? codePath,
          description: codePath,
          code: code,
        });
      }
    }
    for (const nextDirectory of nextDirectories) {
      quickPicks = await retrieveQuickPicks(nextDirectory, quickPicks);
    }
    return quickPicks;
  };
  const quickPickItems: Array<QuickPickItemWithCode> = await retrieveQuickPicks(
    "",
    []
  );

  // Insert a snippet to vscode.TextEditor
  const insertSnippet = async (textEditor: TextEditor): Promise<void> => {
    // Show prompt to select a snippet
    const quickPick: QuickPickItemWithCode | undefined =
      await window.showQuickPick(quickPickItems, {
        placeHolder: "Select a snippet to insert",
        matchOnDescription: true,
      });

    // Escaped
    if (quickPick === undefined) {
      return;
    }

    // Prepare region delimiter
    const extension: string =
      parseExtension(textEditor.document.fileName) ?? "";
    const insertRegion: boolean =
      addRegion &&
      !addRegionExcept.includes(quickPick.description ?? "") &&
      extension in beginRegion &&
      extension in endRegion;
    const header: string = insertRegion
      ? `${beginRegion[extension].replace(
          SNIPPETPATH,
          quickPick.description ?? SNIPPETPATH
        )}\n`
      : "";
    const footer: string = insertRegion
      ? `${endRegion[extension].replace(
          SNIPPETPATH,
          quickPick.description ?? SNIPPETPATH
        )}\n`
      : "";

    textEditor.insertSnippet(
      new SnippetString(header + quickPick.code + footer)
    );
  };

  // Insert snippet
  context.subscriptions.push(
    commands.registerTextEditorCommand(
      `${pkg}.insert-snippet`,
      async (textEditor: TextEditor) => {
        await insertSnippet(textEditor);
      }
    )
  );

  // Insert snippet and fold
  context.subscriptions.push(
    commands.registerTextEditorCommand(
      `${pkg}.insert-snippet-and-fold`,
      async (textEditor: TextEditor) => {
        await insertSnippet(textEditor);
        commands.executeCommand(`editor.foldAllMarkerRegions`);
      }
    )
  );
}

export function deactivate() {}
