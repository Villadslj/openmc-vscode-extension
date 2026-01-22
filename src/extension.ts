import * as vscode from 'vscode';
import { StatepointEditorProvider } from './statepointEditor';

export function activate(context: vscode.ExtensionContext) {
    console.log('OpenMC Statepoint Inspector is now active');

    // Register the custom editor provider
    const provider = new StatepointEditorProvider(context);
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

    context.subscriptions.push(openStatepointCommand);
}

export function deactivate() {
    console.log('OpenMC Statepoint Inspector is now deactivated');
}
