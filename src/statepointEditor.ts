import * as vscode from 'vscode';
import * as path from 'path';
import { StatepointParser } from './statepointParser';

export class StatepointEditorProvider implements vscode.CustomReadonlyEditorProvider {
    constructor(private readonly context: vscode.ExtensionContext) {}

    async openCustomDocument(
        uri: vscode.Uri,
        openContext: vscode.CustomDocumentOpenContext,
        token: vscode.CancellationToken
    ): Promise<vscode.CustomDocument> {
        return { uri, dispose: () => {} };
    }

    async resolveCustomEditor(
        document: vscode.CustomDocument,
        webviewPanel: vscode.WebviewPanel,
        token: vscode.CancellationToken
    ): Promise<void> {
        webviewPanel.webview.options = {
            enableScripts: true,
        };

        // Load and parse the statepoint file
        try {
            const parser = new StatepointParser();
            const data = await parser.parseFile(document.uri.fsPath);
            
            webviewPanel.webview.html = this.getWebviewContent(data, document.uri);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            webviewPanel.webview.html = this.getErrorContent(errorMessage);
        }
    }

    private getWebviewContent(data: any, uri: vscode.Uri): string {
        const fileName = path.basename(uri.fsPath);
        
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>OpenMC Statepoint Viewer</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 20px;
            line-height: 1.6;
        }
        h1, h2, h3 {
            color: var(--vscode-editor-foreground);
            border-bottom: 1px solid var(--vscode-panel-border);
            padding-bottom: 8px;
        }
        .section {
            margin-bottom: 30px;
            padding: 15px;
            background-color: var(--vscode-editor-inactiveSelectionBackground);
            border-radius: 5px;
        }
        .info-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 15px;
            margin-top: 10px;
        }
        .info-item {
            padding: 10px;
            background-color: var(--vscode-editor-background);
            border-radius: 3px;
        }
        .info-label {
            font-weight: bold;
            color: var(--vscode-textLink-foreground);
        }
        .info-value {
            margin-top: 5px;
        }
        .tally-list, .mesh-list {
            list-style-type: none;
            padding: 0;
        }
        .tally-item, .mesh-item {
            padding: 12px;
            margin: 8px 0;
            background-color: var(--vscode-editor-background);
            border-left: 3px solid var(--vscode-textLink-foreground);
            border-radius: 3px;
        }
        .tally-item:hover, .mesh-item:hover {
            background-color: var(--vscode-list-hoverBackground);
            cursor: pointer;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 10px;
        }
        th, td {
            padding: 8px;
            text-align: left;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        th {
            background-color: var(--vscode-editor-background);
            font-weight: bold;
        }
        .empty-message {
            color: var(--vscode-descriptionForeground);
            font-style: italic;
            padding: 20px;
            text-align: center;
        }
        .chart-container {
            margin-top: 20px;
            padding: 15px;
            background-color: var(--vscode-editor-background);
            border-radius: 5px;
        }
    </style>
</head>
<body>
    <h1>OpenMC Statepoint File: ${fileName}</h1>
    
    <div class="section">
        <h2>General Information</h2>
        <div class="info-grid">
            <div class="info-item">
                <div class="info-label">File Path</div>
                <div class="info-value">${uri.fsPath}</div>
            </div>
            ${data.generalInfo ? Object.entries(data.generalInfo).map(([key, value]) => `
            <div class="info-item">
                <div class="info-label">${this.formatLabel(key)}</div>
                <div class="info-value">${value}</div>
            </div>
            `).join('') : '<div class="empty-message">No general information available</div>'}
        </div>
    </div>

    ${data.tallies && data.tallies.length > 0 ? `
    <div class="section">
        <h2>Tallies (${data.tallies.length})</h2>
        <ul class="tally-list">
            ${data.tallies.map((tally: any, index: number) => `
            <li class="tally-item">
                <div><strong>Tally ${index + 1}</strong></div>
                ${tally.id ? `<div>ID: ${tally.id}</div>` : ''}
                ${tally.name ? `<div>Name: ${tally.name}</div>` : ''}
                ${tally.type ? `<div>Type: ${tally.type}</div>` : ''}
                ${tally.scores ? `<div>Scores: ${Array.isArray(tally.scores) ? tally.scores.join(', ') : tally.scores}</div>` : ''}
                ${tally.filters ? `<div>Filters: ${Array.isArray(tally.filters) ? tally.filters.length : 'N/A'}</div>` : ''}
                ${tally.results ? `<div>Results: ${this.formatResults(tally.results)}</div>` : ''}
            </li>
            `).join('')}
        </ul>
    </div>
    ` : `<div class="section"><h2>Tallies</h2><div class="empty-message">No tallies found in this statepoint file</div></div>`}

    ${data.meshes && data.meshes.length > 0 ? `
    <div class="section">
        <h2>Meshes (${data.meshes.length})</h2>
        <ul class="mesh-list">
            ${data.meshes.map((mesh: any, index: number) => `
            <li class="mesh-item">
                <div><strong>Mesh ${index + 1}</strong></div>
                ${mesh.id ? `<div>ID: ${mesh.id}</div>` : ''}
                ${mesh.type ? `<div>Type: ${mesh.type}</div>` : ''}
                ${mesh.dimension ? `<div>Dimensions: ${Array.isArray(mesh.dimension) ? mesh.dimension.join(' × ') : mesh.dimension}</div>` : ''}
                ${mesh.lower_left ? `<div>Lower Left: [${Array.isArray(mesh.lower_left) ? mesh.lower_left.join(', ') : mesh.lower_left}]</div>` : ''}
                ${mesh.upper_right ? `<div>Upper Right: [${Array.isArray(mesh.upper_right) ? mesh.upper_right.join(', ') : mesh.upper_right}]</div>` : ''}
                ${mesh.width ? `<div>Width: [${Array.isArray(mesh.width) ? mesh.width.join(', ') : mesh.width}]</div>` : ''}
            </li>
            `).join('')}
        </ul>
    </div>
    ` : `<div class="section"><h2>Meshes</h2><div class="empty-message">No meshes found in this statepoint file</div></div>`}

    ${data.summary ? `
    <div class="section">
        <h2>Summary Statistics</h2>
        <table>
            <thead>
                <tr>
                    <th>Property</th>
                    <th>Value</th>
                </tr>
            </thead>
            <tbody>
                ${Object.entries(data.summary).map(([key, value]) => `
                <tr>
                    <td>${this.formatLabel(key)}</td>
                    <td>${value}</td>
                </tr>
                `).join('')}
            </tbody>
        </table>
    </div>
    ` : ''}

    <script>
        // Add interactivity if needed
        console.log('OpenMC Statepoint Viewer loaded');
    </script>
</body>
</html>`;
    }

    private getErrorContent(errorMessage: string): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Error Loading Statepoint File</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 20px;
        }
        .error-container {
            padding: 20px;
            background-color: var(--vscode-inputValidation-errorBackground);
            border: 1px solid var(--vscode-inputValidation-errorBorder);
            border-radius: 5px;
        }
        h1 {
            color: var(--vscode-errorForeground);
        }
        pre {
            background-color: var(--vscode-editor-background);
            padding: 10px;
            border-radius: 3px;
            overflow-x: auto;
        }
    </style>
</head>
<body>
    <div class="error-container">
        <h1>Error Loading Statepoint File</h1>
        <p>An error occurred while trying to parse the statepoint file:</p>
        <pre>${this.escapeHtml(errorMessage)}</pre>
        <p>Please ensure the file is a valid OpenMC statepoint HDF5 file.</p>
    </div>
</body>
</html>`;
    }

    private formatLabel(key: string): string {
        return key
            .replace(/_/g, ' ')
            .replace(/\b\w/g, l => l.toUpperCase());
    }

    private formatResults(results: any): string {
        if (Array.isArray(results)) {
            if (results.length <= 5) {
                return results.map(r => typeof r === 'number' ? r.toExponential(4) : r).join(', ');
            } else {
                return `${results.length} values (min: ${Math.min(...results).toExponential(4)}, max: ${Math.max(...results).toExponential(4)})`;
            }
        }
        return String(results);
    }

    private escapeHtml(unsafe: string): string {
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }
}
