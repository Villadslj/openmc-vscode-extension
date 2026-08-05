import * as vscode from 'vscode';
import { StatepointEditorProvider } from './statepointEditor';
import { DepletionEditorProvider } from './depletionEditor';
import { DepletionParser } from './depletionParser';

export function activate(context: vscode.ExtensionContext) {
    console.log('OpenMC Statepoint Inspector is now active');

    const depletionProvider = new DepletionEditorProvider(context);
    context.subscriptions.push(
        vscode.window.registerCustomEditorProvider('openmc.depletionViewer', depletionProvider)
    );

    // Register the custom editor providers. The statepoint provider falls back
    // to the depletion provider when the opened file turns out to be depletion
    // results, because both editors are registered for "*.h5".
    const provider = new StatepointEditorProvider(context, depletionProvider);
    context.subscriptions.push(
        vscode.window.registerCustomEditorProvider('openmc.statepointViewer', provider)
    );

    // Register command to open statepoint files
    const openStatepointCommand = vscode.commands.registerCommand('openmc.openStatepoint', async () => {
        const options: vscode.OpenDialogOptions = {
            canSelectMany: false,
            openLabel: 'Open Statepoint File',
            filters: {
                'HDF5 Files': ['h5', 'hdf5'],
                'All Files': ['*']
            }
        };

        const fileUri = await vscode.window.showOpenDialog(options);
        if (fileUri && fileUri[0]) {
            await vscode.commands.executeCommand('vscode.openWith', fileUri[0], 'openmc.statepointViewer');
        }
    });

    // Register command to open depletion results files
    const openDepletionCommand = vscode.commands.registerCommand('openmc.openDepletionResults', async () => {
        const options: vscode.OpenDialogOptions = {
            canSelectMany: false,
            openLabel: 'Open Depletion Results File',
            filters: {
                'HDF5 Files': ['h5', 'hdf5'],
                'All Files': ['*']
            }
        };

        const fileUri = await vscode.window.showOpenDialog(options);
        if (fileUri && fileUri[0]) {
            const parser = new DepletionParser();
            const isDepletion = await parser.isDepletionFile(fileUri[0].fsPath);
            if (!isDepletion) {
                vscode.window.showWarningMessage(
                    'The selected file does not look like an OpenMC depletion results file. Opening it anyway.'
                );
            }
            await vscode.commands.executeCommand('vscode.openWith', fileUri[0], 'openmc.depletionViewer');
        }
    });

    context.subscriptions.push(openStatepointCommand, openDepletionCommand);
}

export function deactivate() {
    console.log('OpenMC Statepoint Inspector is now deactivated');
}
