import * as vscode from 'vscode';
import { StatepointEditorProvider } from './statepointEditor';
import { SurfaceSourceEditorProvider } from './surfaceSourceEditor';

export function activate(context: vscode.ExtensionContext) {
    console.log('OpenMC Statepoint Inspector is now active');

    // Register the statepoint custom editor provider
    const statepointProvider = new StatepointEditorProvider(context);
    context.subscriptions.push(
        vscode.window.registerCustomEditorProvider('openmc.statepointViewer', statepointProvider)
    );

    // Register the surface source custom editor provider
    const surfaceSourceProvider = new SurfaceSourceEditorProvider(context);
    context.subscriptions.push(
        vscode.window.registerCustomEditorProvider('openmc.surfaceSourceViewer', surfaceSourceProvider)
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

    // Register command to open surface source files
    const openSurfaceSourceCommand = vscode.commands.registerCommand('openmc.openSurfaceSource', async () => {
        const options: vscode.OpenDialogOptions = {
            canSelectMany: false,
            openLabel: 'Open Surface Source File',
            filters: {
                'HDF5 Files': ['h5', 'hdf5'],
                'All Files': ['*']
            }
        };

        const fileUri = await vscode.window.showOpenDialog(options);
        if (fileUri && fileUri[0]) {
            await vscode.commands.executeCommand('vscode.openWith', fileUri[0], 'openmc.surfaceSourceViewer');
        }
    });

    context.subscriptions.push(openStatepointCommand);
    context.subscriptions.push(openSurfaceSourceCommand);
}

export function deactivate() {
    console.log('OpenMC Statepoint Inspector is now deactivated');
}
