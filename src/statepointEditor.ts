import * as vscode from 'vscode';
import * as path from 'path';
import { StatepointParser, TallyData, TallyFilter, StatepointData } from './statepointParser';
import { DepletionParser } from './depletionParser';
import { DepletionEditorProvider } from './depletionEditor';

export class StatepointEditorProvider implements vscode.CustomReadonlyEditorProvider {
    // Constants for data visualization
    private readonly MAX_CHART_DATA_POINTS = 500;
    private readonly RESULT_DISPLAY_THRESHOLD = 5;
    private readonly RESULT_EXPONENTIAL_PRECISION = 4;
    private readonly MAX_TABLE_ROWS = 100;
    private readonly MAX_INLINE_ENERGY_BINS = 50;
    
    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly depletionProvider?: DepletionEditorProvider
    ) {}

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
            localResourceRoots: [
                vscode.Uri.file(path.join(this.context.extensionPath, 'node_modules'))
            ]
        };
        const exportMessageSubscription = webviewPanel.webview.onDidReceiveMessage(async message => {
            if (!message || message.command !== 'exportPlot') {
                return;
            }
            const format = message.format === 'png' ? 'png' : message.format === 'csv' ? 'csv' : undefined;
            if (!format || typeof message.data !== 'string') {
                void vscode.window.showErrorMessage('Could not export plot: invalid export data.');
                return;
            }
            const fallbackName = format === 'png' ? 'openmc-plot.png' : 'openmc-plot.csv';
            const suggestedName = this.sanitizeExportFileName(
                typeof message.fileName === 'string' ? message.fileName : fallbackName,
                fallbackName
            );
            const target = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file(path.join(path.dirname(document.uri.fsPath), suggestedName)),
                filters: format === 'png'
                    ? { 'PNG image': ['png'] }
                    : { 'CSV data': ['csv'] }
            });
            if (!target) {
                return;
            }
            try {
                const bytes = format === 'png'
                    ? this.decodePngDataUrl(message.data)
                    : Buffer.from(message.data, 'utf8');
                await vscode.workspace.fs.writeFile(target, bytes);
            } catch (error) {
                void vscode.window.showErrorMessage(
                    `Could not export plot: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        });
        webviewPanel.onDidDispose(() => exportMessageSubscription.dispose());

        // Both viewers are registered for "*.h5", so the file contents decide
        // which one actually renders. Depletion results are handed over to the
        // depletion viewer instead of being shown as an empty statepoint.
        if (this.depletionProvider) {
            const probe = new DepletionParser();
            let isDepletion = false;
            try {
                isDepletion = await probe.isDepletionFile(document.uri.fsPath);
            } catch (e) {
                isDepletion = false;
            }
            if (isDepletion) {
                return this.depletionProvider.resolveCustomEditor(document, webviewPanel, token);
            }
        }

        // Load and parse the statepoint file
        try {
            const parser = new StatepointParser();
            const data = await parser.parseFile(document.uri.fsPath);
            
            webviewPanel.webview.html = this.getWebviewContent(data, document.uri, webviewPanel.webview);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            webviewPanel.webview.html = this.getErrorContent(errorMessage);
        }
    }

    private getWebviewContent(data: StatepointData, uri: vscode.Uri, webview: vscode.Webview): string {
        const fileName = path.basename(uri.fsPath);
        
        // Get Chart.js library from node_modules
        const chartJsPath = vscode.Uri.file(
            path.join(this.context.extensionPath, 'node_modules', 'chart.js', 'dist', 'chart.umd.js')
        );
        const chartJsUri = webview.asWebviewUri(chartJsPath);
        
        // Serialize tally data for JavaScript
        const talliesJson = JSON.stringify(data.tallies || []);
        
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${webview.cspSource} 'unsafe-inline'; style-src ${webview.cspSource} 'unsafe-inline';">
    <title>OpenMC Statepoint Viewer</title>
    <script src="${chartJsUri}"></script>
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
            transition: all 0.2s ease;
        }
        .tally-item:hover, .mesh-item:hover {
            background-color: var(--vscode-list-hoverBackground);
            cursor: pointer;
            transform: translateX(5px);
        }
        .tally-item .click-hint {
            font-size: 0.85em;
            color: var(--vscode-descriptionForeground);
            margin-top: 8px;
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
        
        /* Modal styles */
        .modal-overlay {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0, 0, 0, 0.7);
            z-index: 1000;
            overflow-y: auto;
        }
        .modal-overlay.active {
            display: block;
        }
        .modal-content {
            background-color: var(--vscode-editor-background);
            margin: 30px auto;
            padding: 30px;
            border-radius: 8px;
            max-width: 1200px;
            width: 90%;
            max-height: calc(100vh - 60px);
            overflow-y: auto;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        }
        .modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            border-bottom: 2px solid var(--vscode-textLink-foreground);
            padding-bottom: 15px;
        }
        .modal-header h2 {
            margin: 0;
            border: none;
            padding: 0;
        }
        .close-btn {
            background: none;
            border: none;
            color: var(--vscode-foreground);
            font-size: 28px;
            cursor: pointer;
            padding: 5px 10px;
            border-radius: 4px;
        }
        .close-btn:hover {
            background-color: var(--vscode-list-hoverBackground);
        }
        
        /* Tally detail styles */
        .tally-detail-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            margin-bottom: 25px;
        }
        .detail-card {
            background-color: var(--vscode-editor-inactiveSelectionBackground);
            padding: 15px;
            border-radius: 5px;
        }
        .detail-card h4 {
            margin: 0 0 10px 0;
            color: var(--vscode-textLink-foreground);
        }
        .filter-list {
            list-style: none;
            padding: 0;
            margin: 0;
        }
        .filter-item {
            padding: 8px;
            margin: 5px 0;
            background-color: var(--vscode-editor-background);
            border-radius: 3px;
            border-left: 2px solid var(--vscode-textLink-activeForeground);
        }
        
        /* Chart styles */
        .chart-section {
            margin-top: 25px;
        }
        .chart-container {
            padding: 20px;
            background-color: var(--vscode-editor-inactiveSelectionBackground);
            border-radius: 5px;
            margin-top: 15px;
        }
        .chart-wrapper {
            position: relative;
            height: 400px;
            width: 100%;
        }
        .chart-controls {
            display: flex;
            gap: 15px;
            margin-bottom: 15px;
            flex-wrap: wrap;
            align-items: center;
        }
        .chart-controls label {
            display: flex;
            align-items: center;
            gap: 5px;
        }
        .chart-controls select, .chart-controls input {
            padding: 5px 10px;
            border-radius: 3px;
            border: 1px solid var(--vscode-panel-border);
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
        }
        .chart-controls button {
            padding: 5px 10px;
            border-radius: 3px;
            border: 1px solid var(--vscode-button-border, transparent);
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            cursor: pointer;
        }
        .chart-controls button:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }
        
        /* Results table */
        .results-table-container {
            max-height: 300px;
            overflow-y: auto;
            margin-top: 15px;
        }
        .results-table {
            width: 100%;
            font-size: 0.9em;
        }
        .results-table th, .results-table td {
            padding: 6px 10px;
        }
        
        /* Mesh slice (2D histogram) */
        .heatmap-layout {
            display: flex;
            gap: 15px;
            align-items: flex-start;
            flex-wrap: wrap;
        }
        .heatmap-canvas-wrapper {
            position: relative;
            flex: 1 1 420px;
            min-width: 320px;
        }
        #meshHeatmap {
            width: 100%;
            display: block;
        }
        .heatmap-tooltip {
            position: absolute;
            pointer-events: none;
            display: none;
            padding: 6px 8px;
            font-size: 0.8em;
            font-family: monospace;
            white-space: pre;
            background-color: var(--vscode-editorHoverWidget-background, var(--vscode-editor-background));
            color: var(--vscode-editorHoverWidget-foreground, var(--vscode-foreground));
            border: 1px solid var(--vscode-panel-border);
            border-radius: 3px;
            z-index: 10;
        }
        .heatmap-stats {
            flex: 0 1 240px;
            font-size: 0.85em;
            font-family: monospace;
        }
        .heatmap-stats div {
            margin-bottom: 4px;
        }
        .heatmap-note {
            color: var(--vscode-descriptionForeground);
            font-size: 0.85em;
            margin-top: 10px;
        }

        /* Energy bins display */
        .energy-bins {
            font-family: monospace;
            font-size: 0.85em;
            max-height: 150px;
            overflow-y: auto;
            background-color: var(--vscode-editor-background);
            padding: 10px;
            border-radius: 3px;
            margin-top: 5px;
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
                <div class="info-value">${this.escapeHtml(uri.fsPath)}</div>
            </div>
            ${data.generalInfo ? Object.entries(data.generalInfo).map(([key, value]) => `
            <div class="info-item">
                <div class="info-label">${this.formatLabel(key)}</div>
                <div class="info-value">${this.escapeHtml(String(value))}</div>
            </div>
            `).join('') : '<div class="empty-message">No general information available</div>'}
        </div>
    </div>

    ${data.tallies && data.tallies.length > 0 ? `
    <div class="section">
        <h2>Tallies (${data.tallies.length})</h2>
        <p style="color: var(--vscode-descriptionForeground); font-style: italic;">Click on a tally to view detailed information and visualizations</p>
        <ul class="tally-list">
            ${data.tallies.map((tally: TallyData, index: number) => `
            <li class="tally-item" onclick="showTallyDetail(${index})" data-tally-index="${index}">
                <div><strong>Tally ${tally.id}</strong>${tally.name ? ` - ${this.escapeHtml(tally.name)}` : ''}</div>
                ${tally.estimator ? `<div>Estimator: ${this.escapeHtml(tally.estimator)}</div>` : ''}
                ${tally.scores && tally.scores.length > 0 ? `<div>Scores: ${this.escapeHtml(tally.scores.join(', '))}</div>` : ''}
                ${tally.filters && tally.filters.length > 0 ? `<div>Filters: ${tally.filters.map(f => this.escapeHtml(f.type)).join(', ')}</div>` : ''}
                ${tally.results ? `<div>Results: ${this.formatTallyResults(tally.results)}</div>` : ''}
                <div class="click-hint">📊 Click for detailed view and spectrum visualization</div>
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

    ${data.summary && Object.keys(data.summary).length > 0 ? `
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
                    <td>${this.escapeHtml(String(value))}</td>
                </tr>
                `).join('')}
            </tbody>
        </table>
    </div>
    ` : ''}

    <!-- Tally Detail Modal -->
    <div id="tallyModal" class="modal-overlay" onclick="closeModalOnOverlay(event)">
        <div class="modal-content" onclick="event.stopPropagation()">
            <div class="modal-header">
                <h2 id="modalTitle">Tally Details</h2>
                <button class="close-btn" onclick="closeModal()">&times;</button>
            </div>
            <div id="modalBody">
                <!-- Dynamic content will be inserted here -->
            </div>
        </div>
    </div>

    <script>
        // Store tally data for JavaScript access
        const talliesData = ${talliesJson};
        let currentChart = null;
        let currentProfileChart = null;
        let currentProfileData = null;
        let currentMeshInfo = null;
        let currentHeatmap = null;
        const vscodeApi = acquireVsCodeApi();
        
        // Chart.js configuration for dark mode compatibility
        document.addEventListener('DOMContentLoaded', function() {
            Chart.defaults.color = getComputedStyle(document.body).getPropertyValue('--vscode-foreground') || '#cccccc';
            Chart.defaults.borderColor = getComputedStyle(document.body).getPropertyValue('--vscode-panel-border') || '#444444';
        });
        
        function showTallyDetail(index) {
            const tally = talliesData[index];
            if (!tally) return;
            
            const modal = document.getElementById('tallyModal');
            const modalTitle = document.getElementById('modalTitle');
            const modalBody = document.getElementById('modalBody');
            
            modalTitle.textContent = 'Tally ' + tally.id + (tally.name ? ' - ' + tally.name : '');
            
            let html = '<div class="tally-detail-grid">';
            
            // Basic info card
            html += '<div class="detail-card">';
            html += '<h4>Basic Information</h4>';
            html += '<p><strong>ID:</strong> ' + tally.id + '</p>';
            if (tally.name) html += '<p><strong>Name:</strong> ' + escapeHtml(tally.name) + '</p>';
            if (tally.estimator) html += '<p><strong>Estimator:</strong> ' + escapeHtml(tally.estimator) + '</p>';
            if (tally.numScoreBins) html += '<p><strong>Score Bins:</strong> ' + tally.numScoreBins + '</p>';
            html += '</div>';
            
            // Scores card
            if (tally.scores && tally.scores.length > 0) {
                html += '<div class="detail-card">';
                html += '<h4>Scores</h4>';
                html += '<ul style="margin: 0; padding-left: 20px;">';
                tally.scores.forEach(function(score) {
                    html += '<li>' + escapeHtml(score) + '</li>';
                });
                html += '</ul>';
                html += '</div>';
            }
            
            // Nuclides card
            if (tally.nuclides && tally.nuclides.length > 0) {
                html += '<div class="detail-card">';
                html += '<h4>Nuclides</h4>';
                html += '<ul style="margin: 0; padding-left: 20px;">';
                tally.nuclides.forEach(function(nuclide) {
                    html += '<li>' + escapeHtml(nuclide) + '</li>';
                });
                html += '</ul>';
                html += '</div>';
            }
            
            // Results summary card
            if (tally.results) {
                html += '<div class="detail-card">';
                html += '<h4>Results Summary</h4>';
                html += '<p><strong>Shape:</strong> [' + tally.results.shape.join(', ') + ']</p>';
                html += '<p><strong>Total bins:</strong> ' + tally.results.mean.length + '</p>';
                if (tally.results.mean.length > 0) {
                    const mean = tally.results.mean;
                    let minVal = Infinity;
                    let maxVal = -Infinity;
                    for (let i = 0; i < mean.length; i++) {
                        const value = mean[i];
                        if (!isNaN(value) && isFinite(value)) {
                            if (value < minVal) minVal = value;
                            if (value > maxVal) maxVal = value;
                        }
                    }
                    if (isFinite(minVal) && isFinite(maxVal)) {
                        html += '<p><strong>Min value:</strong> ' + minVal.toExponential(4) + '</p>';
                        html += '<p><strong>Max value:</strong> ' + maxVal.toExponential(4) + '</p>';
                    }
                }
                html += '</div>';
            }
            
            html += '</div>'; // End tally-detail-grid
            
            // Filters section
            if (tally.filters && tally.filters.length > 0) {
                html += '<div class="detail-card" style="margin-bottom: 20px;">';
                html += '<h4>Filters (' + tally.filters.length + ')</h4>';
                html += '<ul class="filter-list">';
                tally.filters.forEach(function(filter, idx) {
                    html += '<li class="filter-item">';
                    html += '<strong>Filter ' + (idx + 1) + ':</strong> ' + escapeHtml(filter.type);
                    if (filter.numBins) html += ' (' + filter.numBins + ' bins)';
                    
                    // Show energy bins for energy filters
                    if (filter.type.toLowerCase().includes('energy') && filter.energyBins && filter.energyBins.length > 0) {
                        html += '<div class="energy-bins">';
                        html += '<strong>Energy bins (eV):</strong><br>';
                        const bins = filter.energyBins;
                        if (bins.length <= ${this.MAX_INLINE_ENERGY_BINS}) {
                            html += bins.map(function(b) { return b.toExponential(3); }).join(', ');
                        } else {
                            html += bins.slice(0, 10).map(function(b) { return b.toExponential(3); }).join(', ');
                            html += ' ... (' + (bins.length - 20) + ' more) ... ';
                            html += bins.slice(-10).map(function(b) { return b.toExponential(3); }).join(', ');
                        }
                        html += '</div>';
                    }
                    
                    // Show cell bins for cell filters
                    if (filter.type.toLowerCase().includes('cell') && filter.cellBins && filter.cellBins.length > 0) {
                        html += '<div style="margin-top: 5px;"><strong>Cell IDs:</strong> ' + filter.cellBins.join(', ') + '</div>';
                    }
                    
                    // Show mesh ID for mesh filters
                    if (filter.meshId !== undefined) {
                        html += '<div style="margin-top: 5px;"><strong>Mesh ID:</strong> ' + filter.meshId + '</div>';
                    }

                    if (isParentNuclideFilter(filter) && filter.bins && filter.bins.length > 0) {
                        html += '<div style="margin-top: 5px;"><strong>Parent nuclides:</strong> ' +
                            filter.bins.map(function(bin) { return escapeHtml(String(bin)); }).join(', ') + '</div>';
                    }
                    
                    html += '</li>';
                });
                html += '</ul>';
                html += '</div>';
            }
            
            // Mesh slice (2D histogram) section
            currentMeshInfo = getMeshVisualizationInfo(tally);
            if (currentMeshInfo && currentMeshInfo.planes.length > 0) {
                html += buildMeshSliceSection(currentMeshInfo, index);
            } else if (hasMeshFilter(tally)) {
                html += '<div class="chart-section">';
                html += '<h3>Mesh Slice (2D)</h3>';
                html += '<div class="heatmap-note">' + escapeHtml(meshUnsupportedReason(tally)) + '</div>';
                html += '</div>';
            }

            // Mesh line profile section
            if (currentMeshInfo && currentMeshInfo.profileAxes.length > 0) {
                html += buildMeshProfileSection(currentMeshInfo, index);
            }

            // Chart section
            if (!currentMeshInfo && tally.results && tally.results.mean && tally.results.mean.length > 0) {
                html += '<div class="chart-section">';
                html += '<h3>Spectrum Visualization</h3>';
                
                // Chart controls
                html += '<div class="chart-controls">';
                html += '<label>Chart Type: <select id="chartType" onchange="updateChart(' + index + ')">';
                html += '<option value="line">Line</option>';
                html += '<option value="bar">Bar</option>';
                html += '<option value="scatter">Scatter</option>';
                html += '</select></label>';
                
                html += '<label>Y-Axis Scale: <select id="yScale" onchange="updateChart(' + index + ')">';
                html += '<option value="logarithmic">Logarithmic</option>';
                html += '<option value="linear">Linear</option>';
                html += '</select></label>';
                
                html += '<label>X-Axis Scale: <select id="xScale" onchange="updateChart(' + index + ')">';
                html += '<option value="logarithmic">Logarithmic</option>';
                html += '<option value="linear">Linear</option>';
                html += '</select></label>';
                
                html += '<label><input type="checkbox" id="showErrorBars" onchange="updateChart(' + index + ')"> Show Error Bars</label>';
                html += '</div>';
                
                html += '<div class="chart-container">';
                html += '<div class="chart-wrapper"><canvas id="detailChart"></canvas></div>';
                html += '</div>';
                html += '</div>';
                
                // Data table
                html += '<div class="chart-section">';
                html += '<h3>Results Data</h3>';
                html += '<div class="results-table-container">';
                html += '<table class="results-table">';
                html += '<thead><tr><th>Bin</th><th>X Value</th><th>Mean</th><th>Std Dev</th><th>Rel. Error</th></tr></thead>';
                html += '<tbody>';
                
                const maxRows = Math.min(${this.MAX_TABLE_ROWS}, tally.results.mean.length);
                const energyFilter = tally.filters ? tally.filters.find(function(f) { return f.type.toLowerCase().includes('energy'); }) : null;
                
                for (let i = 0; i < maxRows; i++) {
                    const mean = tally.results.mean[i];
                    const stdDev = tally.results.stdDev[i];
                    const relError = mean !== 0 ? (stdDev / mean * 100).toFixed(2) + '%' : 'N/A';
                    let xVal = i + 1;
                    
                    if (energyFilter && energyFilter.energyBins && energyFilter.energyBins[i] !== undefined) {
                        xVal = energyFilter.energyBins[i].toExponential(3);
                    }
                    
                    html += '<tr>';
                    html += '<td>' + (i + 1) + '</td>';
                    html += '<td>' + xVal + '</td>';
                    html += '<td>' + mean.toExponential(4) + '</td>';
                    html += '<td>' + stdDev.toExponential(4) + '</td>';
                    html += '<td>' + relError + '</td>';
                    html += '</tr>';
                }
                
                if (tally.results.mean.length > maxRows) {
                    html += '<tr><td colspan="5" style="text-align: center; font-style: italic;">... and ' + (tally.results.mean.length - maxRows) + ' more rows</td></tr>';
                }
                
                html += '</tbody></table>';
                html += '</div></div>';
            }
            
            modalBody.innerHTML = html;
            modal.classList.add('active');
            
            // Create chart if results exist
            if (!currentMeshInfo && tally.results && tally.results.mean && tally.results.mean.length > 0) {
                setTimeout(function() { updateChart(index); }, 100);
            }
            if (currentMeshInfo && currentMeshInfo.planes.length > 0) {
                setTimeout(function() { updateMeshSlice(index); }, 100);
            }
            if (currentMeshInfo && currentMeshInfo.profileAxes.length > 0) {
                setTimeout(function() { updateMeshProfile(index); }, 100);
            }
        }
        
        function updateChart(tallyIndex) {
            const tally = talliesData[tallyIndex];
            if (!tally || !tally.results) return;
            
            const chartType = document.getElementById('chartType').value;
            const yScale = document.getElementById('yScale').value;
            const xScale = document.getElementById('xScale').value;
            const showErrorBars = document.getElementById('showErrorBars').checked;
            
            const ctx = document.getElementById('detailChart');
            if (!ctx) return;
            
            // Destroy previous chart
            if (currentChart) {
                currentChart.destroy();
            }
            
            // Prepare data
            const mean = tally.results.mean;
            const stdDev = tally.results.stdDev;
            
            // Get energy bins if available
            const energyFilter = tally.filters ? tally.filters.find(function(f) { return f.type.toLowerCase().includes('energy'); }) : null;
            const energyBins = energyFilter ? energyFilter.energyBins : null;
            
            // Create labels and data
            let labels = [];
            let xValues = [];
            const dataPoints = [];
            
            for (let i = 0; i < mean.length; i++) {
                let xVal = i + 1;
                let label = 'Bin ' + (i + 1);
                
                if (energyBins && energyBins[i] !== undefined) {
                    xVal = energyBins[i];
                    label = energyBins[i].toExponential(2) + ' eV';
                }
                
                xValues.push(xVal);
                labels.push(label);
                
                if (chartType === 'scatter') {
                    dataPoints.push({ x: xVal, y: mean[i] });
                }
            }
            
            // Filter out zero/negative values for log scale
            let filteredMean = mean;
            let filteredStdDev = stdDev;
            let filteredLabels = labels;
            let filteredXValues = xValues;
            
            if (yScale === 'logarithmic') {
                const validIndices = [];
                for (let i = 0; i < mean.length; i++) {
                    if (mean[i] > 0) {
                        validIndices.push(i);
                    }
                }
                filteredMean = validIndices.map(function(i) { return mean[i]; });
                filteredStdDev = validIndices.map(function(i) { return stdDev[i]; });
                filteredLabels = validIndices.map(function(i) { return labels[i]; });
                filteredXValues = validIndices.map(function(i) { return xValues[i]; });
            }
            
            // Limit data points for performance
            const maxPoints = ${this.MAX_CHART_DATA_POINTS};
            if (filteredMean.length > maxPoints) {
                const step = Math.ceil(filteredMean.length / maxPoints);
                const sampledIndices = [];
                for (let i = 0; i < filteredMean.length; i += step) {
                    sampledIndices.push(i);
                }
                filteredMean = sampledIndices.map(function(i) { return filteredMean[i]; });
                filteredStdDev = sampledIndices.map(function(i) { return filteredStdDev[i]; });
                filteredLabels = sampledIndices.map(function(i) { return filteredLabels[i]; });
                filteredXValues = sampledIndices.map(function(i) { return filteredXValues[i]; });
            }
            
            // Prepare datasets
            const datasets = [{
                label: 'Mean Value',
                data: chartType === 'scatter' ? filteredXValues.map(function(x, i) { return { x: x, y: filteredMean[i] }; }) : filteredMean,
                backgroundColor: 'rgba(54, 162, 235, 0.5)',
                borderColor: 'rgba(54, 162, 235, 1)',
                borderWidth: 2,
                fill: chartType === 'line',
                pointRadius: chartType === 'scatter' ? 3 : 2,
                tension: 0.1
            }];
            
            // Add error bars if requested
            if (showErrorBars && chartType === 'line') {
                const upperBound = filteredMean.map(function(m, i) { return m + filteredStdDev[i]; });
                const lowerBound = filteredMean.map(function(m, i) { return Math.max(0.0000001, m - filteredStdDev[i]); });
                
                datasets.push({
                    label: 'Upper Bound (+σ)',
                    data: upperBound,
                    borderColor: 'rgba(255, 99, 132, 0.5)',
                    borderWidth: 1,
                    fill: false,
                    pointRadius: 0,
                    borderDash: [5, 5]
                });
                datasets.push({
                    label: 'Lower Bound (-σ)',
                    data: lowerBound,
                    borderColor: 'rgba(255, 99, 132, 0.5)',
                    borderWidth: 1,
                    fill: false,
                    pointRadius: 0,
                    borderDash: [5, 5]
                });
            }
            
            // Determine if x-axis should use energy labels
            const useEnergyLabels = energyBins && energyBins.length > 0;
            const xAxisTitle = useEnergyLabels ? 'Energy (eV)' : 'Bin Index';
            
            currentChart = new Chart(ctx, {
                type: chartType === 'scatter' ? 'scatter' : chartType,
                data: {
                    labels: filteredLabels,
                    datasets: datasets
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: {
                        intersect: false,
                        mode: 'index'
                    },
                    plugins: {
                        legend: {
                            display: true,
                            position: 'top'
                        },
                        title: {
                            display: true,
                            text: tally.scores && tally.scores.length > 0 ? tally.scores.join(', ') + ' Spectrum' : 'Tally Spectrum'
                        },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    const value = context.parsed.y;
                                    return context.dataset.label + ': ' + value.toExponential(4);
                                }
                            }
                        }
                    },
                    scales: {
                        x: {
                            type: xScale,
                            title: {
                                display: true,
                                text: xAxisTitle
                            },
                            ticks: {
                                callback: function(value) {
                                    if (typeof value === 'number') {
                                        return value.toExponential(1);
                                    }
                                    return value;
                                },
                                maxTicksLimit: 10
                            }
                        },
                        y: {
                            type: yScale,
                            title: {
                                display: true,
                                text: 'Value'
                            },
                            ticks: {
                                callback: function(value) {
                                    return value.toExponential(2);
                                }
                            }
                        }
                    }
                }
            });
        }
        
        // ---------------------------------------------------------------
        // Mesh slice (2D histogram) support
        // ---------------------------------------------------------------
        const AXIS_NAMES = ['X', 'Y', 'Z'];
        const MESH_PLANES = [
            { id: 'xy', label: 'XY', axes: [0, 1], normal: 2 },
            { id: 'xz', label: 'XZ', axes: [0, 2], normal: 1 },
            { id: 'yz', label: 'YZ', axes: [1, 2], normal: 0 }
        ];
        // Viridis-like colour anchors (perceptually uniform, colour-blind friendly)
        const COLORMAP = [
            [68, 1, 84], [72, 40, 120], [62, 74, 137], [49, 104, 142],
            [38, 130, 142], [31, 158, 137], [53, 183, 121], [109, 205, 89],
            [180, 222, 44], [253, 231, 37]
        ];

        function isMeshFilter(filter) {
            return !!filter && typeof filter.type === 'string' && filter.type.toLowerCase().indexOf('mesh') !== -1;
        }

        function isParentNuclideFilter(filter) {
            if (!filter || typeof filter.type !== 'string') return false;
            return filter.type.toLowerCase().replace(/[^a-z]/g, '') === 'parentnuclide';
        }

        function isDoseTally(tally) {
            const name = String((tally && tally.name) || '');
            return /(^|[^a-z])dose([^a-z]|$)/i.test(name) || name.toLowerCase().indexOf('dose_') !== -1;
        }

        function hasMeshFilter(tally) {
            return !!(tally.filters && tally.filters.some(isMeshFilter));
        }

        function meshUnsupportedReason(tally) {
            const filter = tally.filters.filter(isMeshFilter)[0];
            if (!filter || !filter.mesh) {
                return 'The mesh geometry referenced by this tally could not be read from the file, so a 2D slice cannot be shown.';
            }
            const mesh = filter.mesh;
            const type = String(mesh.type || 'regular').toLowerCase();
            if (type.indexOf('regular') === -1 && type.indexOf('rectilinear') === -1) {
                return 'Mesh type "' + mesh.type + '" is not supported by the 2D slice view (only regular and rectilinear meshes are supported).';
            }
            if (!mesh.dimension || mesh.dimension.length < 2) {
                return 'This mesh has fewer than two dimensions, so there is no plane to display.';
            }
            const dims = meshDims(mesh);
            if (!MESH_PLANES.some(function(p) { return dims[p.axes[0]] > 1 && dims[p.axes[1]] > 1; })) {
                return 'This mesh has only one element along at least two axes, so there is no 2D plane to display.';
            }
            return 'The tally results could not be mapped onto the mesh (unexpected number of result bins), so the 2D slice view is unavailable.';
        }

        function meshDims(mesh) {
            const d = mesh.dimension || [];
            return [
                Number(d[0]) || 0,
                d.length > 1 ? (Number(d[1]) || 0) : 1,
                d.length > 2 ? (Number(d[2]) || 0) : 1
            ];
        }

        function getMeshVisualizationInfo(tally) {
            if (!tally || !tally.results || !tally.results.mean || tally.results.mean.length === 0) return null;
            if (!tally.filters || tally.filters.length === 0) return null;

            let meshIdx = -1;
            for (let i = 0; i < tally.filters.length; i++) {
                if (isMeshFilter(tally.filters[i])) { meshIdx = i; break; }
            }
            if (meshIdx < 0) return null;

            const mesh = tally.filters[meshIdx].mesh;
            if (!mesh || !mesh.dimension || mesh.dimension.length < 1) return null;

            const type = String(mesh.type || 'regular').toLowerCase();
            if (type.indexOf('regular') === -1 && type.indexOf('rectilinear') === -1) return null;

            const dims = meshDims(mesh);
            if (dims.some(function(d) { return !isFinite(d) || d < 1; })) return null;

            const planes = MESH_PLANES.filter(function(p) { return dims[p.axes[0]] > 1 && dims[p.axes[1]] > 1; });
            const profileAxes = [0, 1, 2].filter(function(axis) { return dims[axis] > 1; });
            if (profileAxes.length === 0) return null;

            const nScores = (tally.scores && tally.scores.length) ? tally.scores.length : 1;
            const nNuclides = (tally.nuclides && tally.nuclides.length) ? tally.nuclides.length : 1;
            const meshBins = dims[0] * dims[1] * dims[2];
            const binCounts = tally.filters.map(function(f, i) {
                if (i === meshIdx) return meshBins;
                return (f.numBins && f.numBins > 0) ? f.numBins : 1;
            });

            // OpenMC stores results as [filter bins..., nuclide, score] in row-major
            // order, so the last filter varies fastest. Verify the layout before
            // trusting any index arithmetic.
            let total = nScores * nNuclides;
            for (let i = 0; i < binCounts.length; i++) { total *= binCounts[i]; }
            if (total !== tally.results.mean.length) return null;

            const strides = new Array(binCounts.length);
            let acc = nScores * nNuclides;
            for (let i = binCounts.length - 1; i >= 0; i--) {
                strides[i] = acc;
                acc *= binCounts[i];
            }

            return {
                tally: tally,
                mesh: mesh,
                meshIdx: meshIdx,
                nAxes: Math.max(1, Math.min(3, mesh.dimension.length)),
                dims: dims,
                binCounts: binCounts,
                strides: strides,
                nScores: nScores,
                nNuclides: nNuclides,
                planes: planes,
                profileAxes: profileAxes
            };
        }

        function elementWidth(mesh, axis, idx, dims) {
            if (mesh.grids && mesh.grids[axis] && mesh.grids[axis].length > idx + 1) {
                return mesh.grids[axis][idx + 1] - mesh.grids[axis][idx];
            }
            if (mesh.width && isFinite(mesh.width[axis])) {
                return mesh.width[axis];
            }
            if (mesh.lowerLeft && mesh.upperRight && isFinite(mesh.lowerLeft[axis]) && isFinite(mesh.upperRight[axis]) && dims[axis] > 0) {
                return (mesh.upperRight[axis] - mesh.lowerLeft[axis]) / dims[axis];
            }
            return NaN;
        }

        function elementLow(mesh, axis, idx, dims) {
            if (mesh.grids && mesh.grids[axis] && mesh.grids[axis].length > idx) {
                return mesh.grids[axis][idx];
            }
            if (mesh.lowerLeft && isFinite(mesh.lowerLeft[axis])) {
                const w = elementWidth(mesh, axis, idx, dims);
                if (isFinite(w)) return mesh.lowerLeft[axis] + idx * w;
            }
            return NaN;
        }

        function coordinateAt(mesh, axis, position, dims) {
            const bounded = Math.max(0, Math.min(dims[axis], position));
            if (bounded === dims[axis]) {
                const last = dims[axis] - 1;
                return elementLow(mesh, axis, last, dims) + elementWidth(mesh, axis, last, dims);
            }
            const idx = Math.floor(bounded);
            const low = elementLow(mesh, axis, idx, dims);
            const width = elementWidth(mesh, axis, idx, dims);
            return low + (bounded - idx) * width;
        }

        function elementVolume(info, idxs) {
            let volume = 1;
            for (let axis = 0; axis < info.nAxes; axis++) {
                const w = elementWidth(info.mesh, axis, idxs[axis], info.dims);
                if (!isFinite(w) || w <= 0) return NaN;
                volume *= w;
            }
            return volume;
        }

        function meshVolumeAvailable(info) {
            return isFinite(elementVolume(info, [0, 0, 0]));
        }

        function filterBinLabel(filter, i) {
            const type = String(filter.type || '').toLowerCase();
            if (isParentNuclideFilter(filter) && filter.bins && filter.bins[i] !== undefined) {
                return String(filter.bins[i]);
            }
            if (type.indexOf('energy') !== -1 && filter.energyBins && filter.energyBins.length > i + 1) {
                return filter.energyBins[i].toExponential(3) + ' - ' + filter.energyBins[i + 1].toExponential(3) + ' eV';
            }
            if (type.indexOf('cell') !== -1 && filter.cellBins && filter.cellBins[i] !== undefined) {
                return 'Cell ' + filter.cellBins[i];
            }
            return 'Bin ' + (i + 1);
        }

        function optionsHtml(count, labelFn) {
            let html = '';
            for (let i = 0; i < count; i++) {
                html += '<option value="' + i + '">' + escapeHtml(labelFn(i)) + '</option>';
            }
            return html;
        }

        function buildMeshSliceSection(info, index) {
            const tally = info.tally;
            let html = '<div class="chart-section">';
            html += '<h3>Mesh Slice (2D)</h3>';
            html += '<div class="chart-controls">';

            html += '<label>Plane: <select id="meshPlane" onchange="onMeshPlaneChange(' + index + ')">';
            info.planes.forEach(function(p) {
                html += '<option value="' + p.id + '">' + p.label + '</option>';
            });
            html += '</select></label>';

            html += '<label>Slice: <select id="meshSliceIndex" onchange="updateMeshSlice(' + index + ')"></select></label>';

            // One selector per remaining filter so a single 2D field is selected
            info.binCounts.forEach(function(count, i) {
                if (i === info.meshIdx || count <= 1) return;
                const filter = tally.filters[i];
                html += '<label>' + escapeHtml(formatFilterName(filter.type)) + ': ';
                html += '<select id="meshFilterSel_' + i + '" onchange="updateMeshSlice(' + index + ')">';
                if (isParentNuclideFilter(filter)) {
                    html += '<option value="-1">Combined (all parent nuclides)</option>';
                }
                html += optionsHtml(count, function(b) { return filterBinLabel(filter, b); });
                html += '</select></label>';
            });

            if (info.nNuclides > 1) {
                html += '<label>Nuclide: <select id="meshNuclide" onchange="updateMeshSlice(' + index + ')">';
                html += optionsHtml(info.nNuclides, function(i) { return tally.nuclides[i]; });
                html += '</select></label>';
            }

            if (info.nScores > 1) {
                html += '<label>Score: <select id="meshScore" onchange="updateMeshSlice(' + index + ')">';
                html += optionsHtml(info.nScores, function(i) { return tally.scores[i]; });
                html += '</select></label>';
            }

            const volumeAvailable = meshVolumeAvailable(info);
            html += '<label><input type="checkbox" id="meshNormalize" onchange="updateMeshSlice(' + index + ')"' +
                (volumeAvailable && isDoseTally(tally) ? ' checked' : '') +
                (volumeAvailable ? '' : ' disabled') + '> Normalize by volume' +
                (volumeAvailable ? '' : ' (unavailable)') + '</label>';

            html += '<label>Scale factor: <input type="number" id="meshScale" value="1" step="any" style="width: 110px;" oninput="updateMeshSlice(' + index + ')"></label>';

            if (isDoseTally(tally)) {
                html += '<label>Dose unit: <select id="meshDoseMagnitude" onchange="updateMeshSlice(' + index + ')">';
                html += '<option value="1">pSv</option>';
                html += '<option value="1e-3">nSv</option>';
                html += '<option value="1e-6">µSv</option>';
                html += '<option value="1e-9">mSv</option>';
                html += '<option value="1e-12">Sv</option>';
                html += '</select></label>';
                html += '<label>Per: <select id="meshTimeUnit" onchange="updateMeshSlice(' + index + ')">';
                html += '<option value="1">s</option>';
                html += '<option value="60">min</option>';
                html += '<option value="3600">h</option>';
                html += '<option value="86400">day</option>';
                html += '</select></label>';
            }

            html += '<label>Colour scale: <select id="meshColorScale" onchange="updateMeshSlice(' + index + ')">';
            html += '<option value="linear">Linear</option>';
            html += '<option value="logarithmic">Logarithmic</option>';
            html += '</select></label>';

            html += '<button type="button" onclick="zoomMesh(1.5)">Zoom in</button>';
            html += '<button type="button" onclick="zoomMesh(1 / 1.5)">Zoom out</button>';
            html += '<button type="button" onclick="resetMeshZoom()">Reset zoom</button>';
            html += '<button type="button" onclick="exportMeshCsv()">Export CSV</button>';
            html += '<button type="button" onclick="exportCanvasPng(\\'meshHeatmap\\', meshExportName(\\'2d\\'))">Export PNG</button>';
            html += '</div>';

            html += '<div class="chart-container"><div class="heatmap-layout">';
            html += '<div class="heatmap-canvas-wrapper">';
            html += '<canvas id="meshHeatmap" height="420"></canvas>';
            html += '<div id="meshTooltip" class="heatmap-tooltip"></div>';
            html += '</div>';
            html += '<div class="heatmap-stats" id="meshStats"></div>';
            html += '</div>';
            html += '<div class="heatmap-note" id="meshNote"></div>';
            html += '</div></div>';
            return html;
        }

        function axisBinLabel(info, axis, i) {
            const low = elementLow(info.mesh, axis, i, info.dims);
            const width = elementWidth(info.mesh, axis, i, info.dims);
            let label = AXIS_NAMES[axis] + ' index ' + (i + 1);
            if (isFinite(low) && isFinite(width)) {
                label += ' (' + formatCoord(low) + ' to ' + formatCoord(low + width) + ' cm)';
            }
            return label;
        }

        function buildMeshProfileSection(info, index) {
            const tally = info.tally;
            let html = '<div class="chart-section">';
            html += '<h3>Mesh Line Profile (1D)</h3>';
            html += '<div class="chart-controls">';

            html += '<label>Profile axis: <select id="profileAxis" onchange="onMeshProfileAxisChange(' + index + ')">';
            info.profileAxes.forEach(function(axis) {
                html += '<option value="' + axis + '">' + AXIS_NAMES[axis] + '</option>';
            });
            html += '</select></label>';

            for (let axis = 0; axis < info.nAxes; axis++) {
                html += '<label id="profileFixedWrap_' + axis + '">' + AXIS_NAMES[axis] + ' position: ';
                html += '<select id="profileFixed_' + axis + '" onchange="updateMeshProfile(' + index + ')">';
                html += optionsHtml(info.dims[axis], function(i) { return axisBinLabel(info, axis, i); });
                html += '</select></label>';
            }

            info.binCounts.forEach(function(count, i) {
                if (i === info.meshIdx || count <= 1) return;
                const filter = tally.filters[i];
                html += '<label>' + escapeHtml(formatFilterName(filter.type)) + ': ';
                html += '<select id="profileFilterSel_' + i + '" onchange="updateMeshProfile(' + index + ')">';
                if (isParentNuclideFilter(filter)) {
                    html += '<option value="-1">Combined (all parent nuclides)</option>';
                }
                html += optionsHtml(count, function(b) { return filterBinLabel(filter, b); });
                html += '</select></label>';
            });

            if (info.nNuclides > 1) {
                html += '<label>Nuclide: <select id="profileNuclide" onchange="updateMeshProfile(' + index + ')">';
                html += optionsHtml(info.nNuclides, function(i) { return tally.nuclides[i]; });
                html += '</select></label>';
            }

            if (info.nScores > 1) {
                html += '<label>Score: <select id="profileScore" onchange="updateMeshProfile(' + index + ')">';
                html += optionsHtml(info.nScores, function(i) { return tally.scores[i]; });
                html += '</select></label>';
            }

            const volumeAvailable = meshVolumeAvailable(info);
            html += '<label><input type="checkbox" id="profileNormalize" onchange="updateMeshProfile(' + index + ')"' +
                (volumeAvailable && isDoseTally(tally) ? ' checked' : '') +
                (volumeAvailable ? '' : ' disabled') + '> Normalize by volume' +
                (volumeAvailable ? '' : ' (unavailable)') + '</label>';
            html += '<label>Scale factor: <input type="number" id="profileScale" value="1" step="any" style="width: 110px;" oninput="updateMeshProfile(' + index + ')"></label>';

            if (isDoseTally(tally)) {
                html += '<label>Dose unit: <select id="profileDoseMagnitude" onchange="updateMeshProfile(' + index + ')">';
                html += '<option value="1">pSv</option>';
                html += '<option value="1e-3">nSv</option>';
                html += '<option value="1e-6">µSv</option>';
                html += '<option value="1e-9">mSv</option>';
                html += '<option value="1e-12">Sv</option>';
                html += '</select></label>';
                html += '<label>Per: <select id="profileTimeUnit" onchange="updateMeshProfile(' + index + ')">';
                html += '<option value="1">s</option>';
                html += '<option value="60">min</option>';
                html += '<option value="3600">h</option>';
                html += '<option value="86400">day</option>';
                html += '</select></label>';
            }

            html += '<label>Y-axis scale: <select id="profileYScale" onchange="updateMeshProfile(' + index + ')">';
            html += '<option value="linear">Linear</option>';
            html += '<option value="logarithmic">Logarithmic</option>';
            html += '</select></label>';
            html += '<button type="button" onclick="exportProfileCsv()">Export CSV</button>';
            html += '<button type="button" onclick="exportCanvasPng(\\'meshProfileChart\\', meshExportName(\\'1d\\'))">Export PNG</button>';
            html += '</div>';

            html += '<div class="chart-container"><div class="chart-wrapper"><canvas id="meshProfileChart"></canvas></div></div>';
            html += '<div class="heatmap-note" id="meshProfileNote"></div>';
            html += '<h3>Profile Results Data</h3>';
            html += '<div class="results-table-container">';
            html += '<table class="results-table"><thead><tr>';
            html += '<th>Index</th><th>Coordinate</th><th>Mean</th><th>Std Dev</th><th>Rel. Error</th>';
            html += '</tr></thead><tbody id="meshProfileRows"></tbody></table>';
            html += '</div></div>';
            return html;
        }

        function formatFilterName(type) {
            const clean = String(type || 'filter').replace(/filter$/i, '').replace(/[_-]/g, ' ').trim();
            if (!clean) return 'Filter';
            return clean.charAt(0).toUpperCase() + clean.slice(1);
        }

        function currentPlane(info) {
            const el = document.getElementById('meshPlane');
            const id = el ? el.value : info.planes[0].id;
            const found = info.planes.filter(function(p) { return p.id === id; });
            return found.length ? found[0] : info.planes[0];
        }

        function refreshSliceOptions(info) {
            const select = document.getElementById('meshSliceIndex');
            if (!select) return;
            const plane = currentPlane(info);
            const axis = plane.normal;
            const count = info.dims[axis];
            let html = '';
            for (let i = 0; i < count; i++) {
                const low = elementLow(info.mesh, axis, i, info.dims);
                const width = elementWidth(info.mesh, axis, i, info.dims);
                let label = AXIS_NAMES[axis] + ' index ' + (i + 1);
                if (isFinite(low) && isFinite(width)) {
                    label += ' (' + formatCoord(low) + ' to ' + formatCoord(low + width) + ' cm)';
                }
                html += '<option value="' + i + '">' + escapeHtml(label) + '</option>';
            }
            select.innerHTML = html;
            select.disabled = count <= 1;
        }

        function onMeshPlaneChange(tallyIndex) {
            if (!currentMeshInfo) return;
            refreshSliceOptions(currentMeshInfo);
            updateMeshSlice(tallyIndex);
        }

        function formatCoord(value) {
            if (!isFinite(value)) return 'n/a';
            const abs = Math.abs(value);
            if (abs !== 0 && (abs < 0.01 || abs >= 10000)) return value.toExponential(2);
            return value.toFixed(2);
        }

        function selectedIndex(id) {
            const el = document.getElementById(id);
            if (!el) return 0;
            const value = parseInt(el.value, 10);
            return isFinite(value) && value >= 0 ? value : 0;
        }

        function selectedFilterBins(info, filterIndex, prefix) {
            const count = info.binCounts[filterIndex];
            if (filterIndex === info.meshIdx || count <= 1) return [0];
            const filter = info.tally.filters[filterIndex];
            const el = document.getElementById(prefix + 'FilterSel_' + filterIndex);
            const selected = el ? parseInt(el.value, 10) : 0;
            if (isParentNuclideFilter(filter) && selected === -1) {
                return Array.from({ length: count }, function(_, i) { return i; });
            }
            return [isFinite(selected) && selected >= 0 ? Math.min(selected, count - 1) : 0];
        }

        function selectedOptionText(id, fallback) {
            const el = document.getElementById(id);
            const option = el && el.options && el.selectedIndex >= 0 ? el.options[el.selectedIndex] : null;
            return option ? option.text : fallback;
        }

        function doseUnitInfo(prefix) {
            const doseEl = document.getElementById(prefix + 'DoseMagnitude');
            if (!doseEl) return { factor: 1, label: '' };
            const timeEl = document.getElementById(prefix + 'TimeUnit');
            const doseFactor = parseFloat(doseEl.value);
            const timeFactor = timeEl ? parseFloat(timeEl.value) : 1;
            const doseLabel = selectedOptionText(prefix + 'DoseMagnitude', 'pSv');
            const timeLabel = selectedOptionText(prefix + 'TimeUnit', 's');
            return {
                factor: (isFinite(doseFactor) ? doseFactor : 1) * (isFinite(timeFactor) ? timeFactor : 1),
                label: doseLabel + '/' + timeLabel
            };
        }

        function readMeshSelection(info, prefix) {
            const scaleInput = document.getElementById(prefix + 'Scale');
            const parsedScale = scaleInput ? parseFloat(scaleInput.value) : 1;
            const scale = isFinite(parsedScale) ? parsedScale : 1;
            const doseUnit = doseUnitInfo(prefix);
            const filterBins = info.binCounts.map(function(count, i) {
                    return selectedFilterBins(info, i, prefix);
                });
            let combinedParentCount = 0;
            info.tally.filters.forEach(function(filter, i) {
                if (isParentNuclideFilter(filter) && filterBins[i].length > 1) {
                    combinedParentCount += filterBins[i].length;
                }
            });
            return {
                filterBins: filterBins,
                nuclideIdx: info.nNuclides > 1 ? Math.min(selectedIndex(prefix + 'Nuclide'), info.nNuclides - 1) : 0,
                scoreIdx: info.nScores > 1 ? Math.min(selectedIndex(prefix + 'Score'), info.nScores - 1) : 0,
                normalize: !!(document.getElementById(prefix + 'Normalize') || {}).checked,
                displayScale: scale * doseUnit.factor,
                unitLabel: doseUnit.label,
                combinedParentCount: combinedParentCount
            };
        }

        function meshBinResult(info, idxs, selection) {
            const meshBin = idxs[0] + info.dims[0] * (idxs[1] + info.dims[1] * idxs[2]);
            const mean = info.tally.results.mean;
            const stdDev = info.tally.results.stdDev;
            let value = 0;
            let variance = 0;

            function addFilterCombination(filterIndex, flat) {
                if (filterIndex >= info.binCounts.length) {
                    const binValue = Number(mean[flat]);
                    const binError = Number(stdDev[flat]);
                    value += binValue;
                    variance += binError * binError;
                    return;
                }
                const bins = filterIndex === info.meshIdx ? [meshBin] : selection.filterBins[filterIndex];
                bins.forEach(function(bin) {
                    addFilterCombination(filterIndex + 1, flat + bin * info.strides[filterIndex]);
                });
            }

            addFilterCombination(0, selection.nuclideIdx * info.nScores + selection.scoreIdx);
            let error = Math.sqrt(variance);
            if (selection.normalize) {
                const volume = elementVolume(info, idxs);
                if (isFinite(volume) && volume > 0) {
                    value /= volume;
                    error /= volume;
                } else {
                    value = NaN;
                    error = NaN;
                }
            }
            return {
                value: value * selection.displayScale,
                error: error * Math.abs(selection.displayScale)
            };
        }

        function updateMeshSlice(tallyIndex) {
            const info = currentMeshInfo;
            if (!info) return;
            const canvas = document.getElementById('meshHeatmap');
            if (!canvas) return;

            const sliceSelect = document.getElementById('meshSliceIndex');
            if (sliceSelect && sliceSelect.options.length === 0) {
                refreshSliceOptions(info);
            }

            const plane = currentPlane(info);
            const axisA = plane.axes[0];
            const axisB = plane.axes[1];
            const normalAxis = plane.normal;
            const sliceIdx = Math.min(selectedIndex('meshSliceIndex'), info.dims[normalAxis] - 1);
            const selection = readMeshSelection(info, 'mesh');
            const colorScale = (document.getElementById('meshColorScale') || {}).value || 'linear';

            const nA = info.dims[axisA];
            const nB = info.dims[axisB];

            const values = [];
            const errors = [];
            for (let b = 0; b < nB; b++) {
                const rowValues = [];
                const rowErrors = [];
                for (let a = 0; a < nA; a++) {
                    const idxs = [0, 0, 0];
                    idxs[axisA] = a;
                    idxs[axisB] = b;
                    idxs[normalAxis] = sliceIdx;
                    const result = meshBinResult(info, idxs, selection);
                    rowValues.push(result.value);
                    rowErrors.push(result.error);
                }
                values.push(rowValues);
                errors.push(rowErrors);
            }

            currentHeatmap = {
                info: info,
                values: values,
                errors: errors,
                nA: nA,
                nB: nB,
                axisA: axisA,
                axisB: axisB,
                normalAxis: normalAxis,
                sliceIdx: sliceIdx,
                colorScale: colorScale,
                normalize: selection.normalize,
                unitLabel: selection.unitLabel,
                combinedParentCount: selection.combinedParentCount,
                zoom: currentHeatmap && currentHeatmap.axisA === axisA && currentHeatmap.axisB === axisB
                    ? currentHeatmap.zoom : 1,
                centerA: currentHeatmap && currentHeatmap.axisA === axisA && currentHeatmap.axisB === axisB
                    ? currentHeatmap.centerA : nA / 2,
                centerB: currentHeatmap && currentHeatmap.axisA === axisA && currentHeatmap.axisB === axisB
                    ? currentHeatmap.centerB : nB / 2
            };

            drawHeatmap(canvas, currentHeatmap);
            updateMeshStats(currentHeatmap);
        }

        function selectedProfileAxis(info) {
            const axis = selectedIndex('profileAxis');
            return info.profileAxes.indexOf(axis) !== -1 ? axis : info.profileAxes[0];
        }

        function refreshProfileAxisControls(info) {
            const profileAxis = selectedProfileAxis(info);
            for (let axis = 0; axis < info.nAxes; axis++) {
                const wrapper = document.getElementById('profileFixedWrap_' + axis);
                if (wrapper) {
                    wrapper.style.display = axis === profileAxis ? 'none' : '';
                }
            }
        }

        function onMeshProfileAxisChange(tallyIndex) {
            if (!currentMeshInfo) return;
            refreshProfileAxisControls(currentMeshInfo);
            updateMeshProfile(tallyIndex);
        }

        function updateMeshProfile(tallyIndex) {
            const info = currentMeshInfo;
            if (!info) return;
            const canvas = document.getElementById('meshProfileChart');
            const rows = document.getElementById('meshProfileRows');
            if (!canvas || !rows) return;

            refreshProfileAxisControls(info);
            const profileAxis = selectedProfileAxis(info);
            const selection = readMeshSelection(info, 'profile');
            const points = [];

            for (let i = 0; i < info.dims[profileAxis]; i++) {
                const idxs = [0, 0, 0];
                for (let axis = 0; axis < info.nAxes; axis++) {
                    idxs[axis] = axis === profileAxis
                        ? i
                        : Math.min(selectedIndex('profileFixed_' + axis), info.dims[axis] - 1);
                }
                const result = meshBinResult(info, idxs, selection);
                const low = elementLow(info.mesh, profileAxis, i, info.dims);
                const width = elementWidth(info.mesh, profileAxis, i, info.dims);
                points.push({
                    index: i,
                    x: isFinite(low) && isFinite(width) ? low + width / 2 : i + 1,
                    low: low,
                    high: isFinite(low) && isFinite(width) ? low + width : NaN,
                    value: result.value,
                    error: result.error
                });
            }

            const unitSuffix = selection.unitLabel ? ' ' + selection.unitLabel : '';
            const profileNote = document.getElementById('meshProfileNote');
            if (profileNote) {
                let note = selection.normalize
                    ? 'Values are normalized by mesh element ' + (info.nAxes === 1 ? 'length' : (info.nAxes === 2 ? 'area' : 'volume')) + '.'
                    : 'Values are not normalized by mesh element size.';
                if (selection.unitLabel) {
                    note += ' The scale factor is interpreted as the source rate in particles/s for the selected time unit.';
                }
                if (selection.combinedParentCount > 0) {
                    note += ' Values sum ' + selection.combinedParentCount + ' parent nuclides; standard deviations are combined in quadrature without covariance data.';
                }
                profileNote.textContent = note;
            }
            rows.innerHTML = points.map(function(point) {
                const coordinate = isFinite(point.low) && isFinite(point.high)
                    ? formatCoord(point.x) + ' cm (' + formatCoord(point.low) + ' to ' + formatCoord(point.high) + ')'
                    : String(point.index + 1);
                const relError = isFinite(point.value) && point.value !== 0 && isFinite(point.error)
                    ? (Math.abs(point.error / point.value) * 100).toFixed(2) + '%'
                    : 'n/a';
                return '<tr><td>' + (point.index + 1) + '</td><td>' + coordinate + '</td>' +
                    '<td>' + (isFinite(point.value) ? point.value.toExponential(4) + unitSuffix : 'n/a') + '</td>' +
                    '<td>' + (isFinite(point.error) ? point.error.toExponential(4) + unitSuffix : 'n/a') + '</td>' +
                    '<td>' + relError + '</td></tr>';
            }).join('');

            if (currentProfileChart) {
                currentProfileChart.destroy();
            }

            const yScale = (document.getElementById('profileYScale') || {}).value || 'linear';
            const chartPoints = points.map(function(point) {
                return {
                    x: point.x,
                    y: yScale === 'logarithmic' && point.value <= 0 ? null : point.value
                };
            });
            const fixedParts = [];
            for (let axis = 0; axis < info.nAxes; axis++) {
                if (axis === profileAxis) continue;
                const idx = Math.min(selectedIndex('profileFixed_' + axis), info.dims[axis] - 1);
                fixedParts.push(axisBinLabel(info, axis, idx));
            }
            const title = AXIS_NAMES[profileAxis] + ' line profile' +
                (fixedParts.length ? ' at ' + fixedParts.join(', ') : '');

            currentProfileChart = new Chart(canvas, {
                type: 'line',
                data: {
                    datasets: [{
                        label: selection.unitLabel ? 'Mean (' + selection.unitLabel + ')' : 'Mean',
                        data: chartPoints,
                        backgroundColor: 'rgba(54, 162, 235, 0.35)',
                        borderColor: 'rgba(54, 162, 235, 1)',
                        borderWidth: 2,
                        pointRadius: points.length <= 200 ? 2 : 0,
                        tension: 0.1
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    parsing: false,
                    interaction: {
                        intersect: false,
                        mode: 'nearest'
                    },
                    plugins: {
                        title: {
                            display: true,
                            text: title
                        },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    const point = points[context.dataIndex];
                                    let text = 'Mean: ' + point.value.toExponential(4) + unitSuffix;
                                    text += ', Std dev: ' + point.error.toExponential(4) + unitSuffix;
                                    return text;
                                }
                            }
                        }
                    },
                    scales: {
                        x: {
                            type: 'linear',
                            title: {
                                display: true,
                                text: AXIS_NAMES[profileAxis] + (isFinite(points[0] && points[0].low) ? ' (cm)' : ' index')
                            }
                        },
                        y: {
                            type: yScale,
                            title: {
                                display: true,
                                text: selection.unitLabel || 'Value'
                            }
                        }
                    }
                }
            });
            currentProfileData = {
                info: info,
                profileAxis: profileAxis,
                points: points,
                unitLabel: selection.unitLabel,
                fixedParts: fixedParts
            };
        }

        function csvCell(value) {
            const text = String(value === undefined || value === null ? '' : value);
            return /[",\\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
        }

        function meshExportName(kind) {
            const tally = currentMeshInfo && currentMeshInfo.tally;
            const id = tally ? tally.id : 'tally';
            const name = tally && tally.name ? '-' + tally.name : '';
            return ('tally-' + id + name + '-mesh-' + kind)
                .replace(/[^a-z0-9._-]+/gi, '-')
                .replace(/-+/g, '-');
        }

        function exportCanvasPng(canvasId, fileName) {
            const canvas = document.getElementById(canvasId);
            if (!canvas || typeof canvas.toDataURL !== 'function') return;
            vscodeApi.postMessage({
                command: 'exportPlot',
                format: 'png',
                fileName: fileName + '.png',
                data: canvas.toDataURL('image/png')
            });
        }

        function exportMeshCsv() {
            const state = currentHeatmap;
            if (!state) return;
            const info = state.info;
            const headers = [
                AXIS_NAMES[state.axisA] + ' index',
                AXIS_NAMES[state.axisA] + ' center (cm)',
                AXIS_NAMES[state.axisB] + ' index',
                AXIS_NAMES[state.axisB] + ' center (cm)',
                AXIS_NAMES[state.normalAxis] + ' index',
                AXIS_NAMES[state.normalAxis] + ' center (cm)',
                'Mean' + (state.unitLabel ? ' (' + state.unitLabel + ')' : ''),
                'Std dev' + (state.unitLabel ? ' (' + state.unitLabel + ')' : ''),
                'Relative error (%)'
            ];
            const lines = [headers.map(csvCell).join(',')];
            for (let b = 0; b < state.nB; b++) {
                for (let a = 0; a < state.nA; a++) {
                    const idxs = [0, 0, 0];
                    idxs[state.axisA] = a;
                    idxs[state.axisB] = b;
                    idxs[state.normalAxis] = state.sliceIdx;
                    const centers = idxs.map(function(idx, axis) {
                        const low = elementLow(info.mesh, axis, idx, info.dims);
                        const width = elementWidth(info.mesh, axis, idx, info.dims);
                        return isFinite(low) && isFinite(width) ? low + width / 2 : '';
                    });
                    const value = state.values[b][a];
                    const error = state.errors[b][a];
                    const relative = isFinite(value) && value !== 0 && isFinite(error)
                        ? Math.abs(error / value) * 100
                        : '';
                    lines.push([
                        a + 1, centers[state.axisA],
                        b + 1, centers[state.axisB],
                        state.sliceIdx + 1, centers[state.normalAxis],
                        value, error, relative
                    ].map(csvCell).join(','));
                }
            }
            vscodeApi.postMessage({
                command: 'exportPlot',
                format: 'csv',
                fileName: meshExportName('2d') + '.csv',
                data: lines.join('\\n')
            });
        }

        function exportProfileCsv() {
            const state = currentProfileData;
            if (!state) return;
            const axisName = AXIS_NAMES[state.profileAxis];
            const headers = [
                axisName + ' index',
                axisName + ' center (cm)',
                axisName + ' lower bound (cm)',
                axisName + ' upper bound (cm)',
                'Mean' + (state.unitLabel ? ' (' + state.unitLabel + ')' : ''),
                'Std dev' + (state.unitLabel ? ' (' + state.unitLabel + ')' : ''),
                'Relative error (%)'
            ];
            const lines = [headers.map(csvCell).join(',')];
            state.points.forEach(function(point) {
                const relative = isFinite(point.value) && point.value !== 0 && isFinite(point.error)
                    ? Math.abs(point.error / point.value) * 100
                    : '';
                lines.push([
                    point.index + 1, point.x, point.low, point.high,
                    point.value, point.error, relative
                ].map(csvCell).join(','));
            });
            if (state.fixedParts.length > 0) {
                lines.unshift('# Fixed coordinates: ' + state.fixedParts.join('; '));
            }
            vscodeApi.postMessage({
                command: 'exportPlot',
                format: 'csv',
                fileName: meshExportName('1d') + '.csv',
                data: lines.join('\\n')
            });
        }

        function zoomMesh(factor, anchorA, anchorB) {
            if (!currentHeatmap || !isFinite(factor) || factor <= 0) return;
            const state = currentHeatmap;
            const oldZoom = state.zoom || 1;
            const newZoom = Math.max(1, Math.min(64, oldZoom * factor));
            const oldWidth = state.nA / oldZoom;
            const oldHeight = state.nB / oldZoom;
            const newWidth = state.nA / newZoom;
            const newHeight = state.nB / newZoom;
            const targetA = isFinite(anchorA) ? anchorA : state.centerA;
            const targetB = isFinite(anchorB) ? anchorB : state.centerB;
            state.centerA = targetA + (state.centerA - targetA) * (newWidth / oldWidth);
            state.centerB = targetB + (state.centerB - targetB) * (newHeight / oldHeight);
            state.zoom = newZoom;
            clampMeshViewport(state);
            const canvas = document.getElementById('meshHeatmap');
            if (canvas) drawHeatmap(canvas, state);
            updateMeshStats(state);
        }

        function resetMeshZoom() {
            if (!currentHeatmap) return;
            currentHeatmap.zoom = 1;
            currentHeatmap.centerA = currentHeatmap.nA / 2;
            currentHeatmap.centerB = currentHeatmap.nB / 2;
            const canvas = document.getElementById('meshHeatmap');
            if (canvas) drawHeatmap(canvas, currentHeatmap);
            updateMeshStats(currentHeatmap);
        }

        function clampMeshViewport(state) {
            const width = state.nA / state.zoom;
            const height = state.nB / state.zoom;
            state.centerA = Math.max(width / 2, Math.min(state.nA - width / 2, state.centerA));
            state.centerB = Math.max(height / 2, Math.min(state.nB - height / 2, state.centerB));
        }

        function heatmapRange(state) {
            let min = Infinity;
            let max = -Infinity;
            let minPositive = Infinity;
            for (let b = 0; b < state.nB; b++) {
                for (let a = 0; a < state.nA; a++) {
                    const v = state.values[b][a];
                    if (!isFinite(v)) continue;
                    if (v < min) min = v;
                    if (v > max) max = v;
                    if (v > 0 && v < minPositive) minPositive = v;
                }
            }
            return { min: min, max: max, minPositive: minPositive };
        }

        function colorFor(fraction) {
            const f = Math.max(0, Math.min(1, fraction));
            const pos = f * (COLORMAP.length - 1);
            const lo = Math.floor(pos);
            const hi = Math.min(COLORMAP.length - 1, lo + 1);
            const t = pos - lo;
            const c = [0, 1, 2].map(function(i) {
                return Math.round(COLORMAP[lo][i] + (COLORMAP[hi][i] - COLORMAP[lo][i]) * t);
            });
            return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
        }

        function normalizedValue(value, range, logScale) {
            if (!isFinite(value)) return null;
            if (logScale) {
                if (value <= 0 || !isFinite(range.minPositive)) return null;
                const lo = Math.log10(range.minPositive);
                const hi = Math.log10(range.max > 0 ? range.max : range.minPositive);
                if (hi <= lo) return 0.5;
                return (Math.log10(value) - lo) / (hi - lo);
            }
            if (range.max <= range.min) return 0.5;
            return (value - range.min) / (range.max - range.min);
        }

        function drawHeatmap(canvas, state) {
            const wrapper = canvas.parentElement;
            const cssWidth = Math.max(360, wrapper ? wrapper.clientWidth : 600);
            const cssHeight = 420;
            const dpr = window.devicePixelRatio || 1;
            canvas.width = Math.round(cssWidth * dpr);
            canvas.height = Math.round(cssHeight * dpr);
            canvas.style.height = cssHeight + 'px';

            const ctx = canvas.getContext('2d');
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, cssWidth, cssHeight);

            const styles = getComputedStyle(document.body);
            const fg = (styles.getPropertyValue('--vscode-foreground') || '#cccccc').trim();
            const border = (styles.getPropertyValue('--vscode-panel-border') || '#666666').trim();

            const margin = { left: 70, right: 100, top: 20, bottom: 50 };
            const plotWidth = Math.max(10, cssWidth - margin.left - margin.right);
            const plotHeight = Math.max(10, cssHeight - margin.top - margin.bottom);

            const info = state.info;
            const range = heatmapRange(state);
            const logScale = state.colorScale === 'logarithmic';

            clampMeshViewport(state);
            const viewWidth = state.nA / state.zoom;
            const viewHeight = state.nB / state.zoom;
            const startA = state.centerA - viewWidth / 2;
            const endA = state.centerA + viewWidth / 2;
            const startB = state.centerB - viewHeight / 2;
            const endB = state.centerB + viewHeight / 2;
            const cellW = plotWidth / viewWidth;
            const cellH = plotHeight / viewHeight;

            ctx.font = '11px sans-serif';
            ctx.fillStyle = fg;
            ctx.strokeStyle = border;

            ctx.save();
            ctx.beginPath();
            ctx.rect(margin.left, margin.top, plotWidth, plotHeight);
            ctx.clip();
            for (let b = Math.floor(startB); b < Math.ceil(endB); b++) {
                if (b < 0 || b >= state.nB) continue;
                for (let a = Math.floor(startA); a < Math.ceil(endA); a++) {
                    if (a < 0 || a >= state.nA) continue;
                    const fraction = normalizedValue(state.values[b][a], range, logScale);
                    // y is drawn bottom-up so the physical axis increases upwards
                    const x = margin.left + (a - startA) * cellW;
                    const y = margin.top + (endB - b - 1) * cellH;
                    if (fraction === null) {
                        ctx.fillStyle = 'rgba(128,128,128,0.25)';
                    } else {
                        ctx.fillStyle = colorFor(fraction);
                    }
                    ctx.fillRect(x, y, Math.ceil(cellW) + 0.5, Math.ceil(cellH) + 0.5);
                }
            }
            ctx.restore();

            ctx.strokeStyle = border;
            ctx.strokeRect(margin.left, margin.top, plotWidth, plotHeight);

            // Axis ticks in physical coordinates
            ctx.fillStyle = fg;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            const xTicks = Math.min(6, Math.max(1, Math.ceil(viewWidth)));
            for (let t = 0; t <= xTicks; t++) {
                const position = startA + t * viewWidth / xTicks;
                const x = margin.left + t * plotWidth / xTicks;
                const coord = coordinateAt(info.mesh, state.axisA, position, info.dims);
                ctx.beginPath();
                ctx.moveTo(x, margin.top + plotHeight);
                ctx.lineTo(x, margin.top + plotHeight + 4);
                ctx.stroke();
                ctx.fillText(formatCoord(coord), x, margin.top + plotHeight + 6);
            }

            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            const yTicks = Math.min(6, Math.max(1, Math.ceil(viewHeight)));
            for (let t = 0; t <= yTicks; t++) {
                const position = startB + t * viewHeight / yTicks;
                const y = margin.top + plotHeight - t * plotHeight / yTicks;
                const coord = coordinateAt(info.mesh, state.axisB, position, info.dims);
                ctx.beginPath();
                ctx.moveTo(margin.left - 4, y);
                ctx.lineTo(margin.left, y);
                ctx.stroke();
                ctx.fillText(formatCoord(coord), margin.left - 6, y);
            }

            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillText(AXIS_NAMES[state.axisA] + ' (cm)', margin.left + plotWidth / 2, cssHeight - 2);
            ctx.save();
            ctx.translate(14, margin.top + plotHeight / 2);
            ctx.rotate(-Math.PI / 2);
            ctx.textBaseline = 'top';
            ctx.fillText(AXIS_NAMES[state.axisB] + ' (cm)', 0, 0);
            ctx.restore();

            drawColorBar(ctx, margin, plotHeight, cssWidth, range, logScale, fg, border);

            state.plot = {
                left: margin.left,
                top: margin.top,
                cellW: cellW,
                cellH: cellH,
                width: plotWidth,
                height: plotHeight,
                startA: startA,
                endB: endB
            };
            attachHeatmapTooltip(canvas, state);
        }

        function drawColorBar(ctx, margin, plotHeight, cssWidth, range, logScale, fg, border) {
            const barWidth = 16;
            const barX = cssWidth - margin.right + 20;
            const barY = margin.top;
            const steps = 64;
            for (let i = 0; i < steps; i++) {
                const fraction = i / (steps - 1);
                ctx.fillStyle = colorFor(fraction);
                const h = plotHeight / steps;
                ctx.fillRect(barX, barY + plotHeight - (i + 1) * h, barWidth, h + 1);
            }
            ctx.strokeStyle = border;
            ctx.strokeRect(barX, barY, barWidth, plotHeight);

            ctx.fillStyle = fg;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            const lo = logScale ? range.minPositive : range.min;
            const hi = range.max;
            const labels = 5;
            for (let i = 0; i < labels; i++) {
                const f = i / (labels - 1);
                let value;
                if (logScale) {
                    if (!isFinite(lo) || !isFinite(hi) || lo <= 0 || hi <= 0) {
                        value = NaN;
                    } else {
                        value = Math.pow(10, Math.log10(lo) + f * (Math.log10(hi) - Math.log10(lo)));
                    }
                } else {
                    value = lo + f * (hi - lo);
                }
                const y = barY + plotHeight - f * plotHeight;
                ctx.fillText(isFinite(value) ? value.toExponential(2) : 'n/a', barX + barWidth + 4, y);
            }
        }

        function attachHeatmapTooltip(canvas, state) {
            const tooltip = document.getElementById('meshTooltip');
            if (!tooltip) return;
            canvas.onmousemove = function(event) {
                const rect = canvas.getBoundingClientRect();
                const x = event.clientX - rect.left;
                const y = event.clientY - rect.top;
                const plot = state.plot;
                if (!plot || x < plot.left || x > plot.left + plot.width || y < plot.top || y > plot.top + plot.height) {
                    tooltip.style.display = 'none';
                    return;
                }
                const a = Math.max(0, Math.min(state.nA - 1,
                    Math.floor(plot.startA + (x - plot.left) / plot.cellW)));
                const b = Math.max(0, Math.min(state.nB - 1,
                    Math.floor(plot.endB - (y - plot.top) / plot.cellH)));
                const value = state.values[b][a];
                const error = state.errors[b][a];
                const info = state.info;
                const idxs = [0, 0, 0];
                idxs[state.axisA] = a;
                idxs[state.axisB] = b;
                idxs[state.normalAxis] = state.sliceIdx;

                let text = AXIS_NAMES[state.axisA] + ' index: ' + (a + 1) + '\\n';
                text += AXIS_NAMES[state.axisB] + ' index: ' + (b + 1) + '\\n';
                for (let axis = 0; axis < info.nAxes; axis++) {
                    const low = elementLow(info.mesh, axis, idxs[axis], info.dims);
                    const width = elementWidth(info.mesh, axis, idxs[axis], info.dims);
                    if (isFinite(low) && isFinite(width)) {
                        text += AXIS_NAMES[axis] + ': ' + formatCoord(low + width / 2) + ' cm\\n';
                    }
                }
                const unitSuffix = state.unitLabel ? ' ' + state.unitLabel : '';
                text += 'Value: ' + (isFinite(value) ? value.toExponential(4) + unitSuffix : 'n/a') + '\\n';
                text += 'Std dev: ' + (isFinite(error) ? error.toExponential(4) + unitSuffix : 'n/a') + '\\n';
                if (state.combinedParentCount > 0) {
                    text += 'Parents: combined ' + state.combinedParentCount + '\\n';
                }
                const relError = (isFinite(value) && value !== 0 && isFinite(error)) ? (Math.abs(error / value) * 100).toFixed(2) + '%' : 'n/a';
                text += 'Rel. error: ' + relError;

                tooltip.textContent = text;
                tooltip.style.display = 'block';
                tooltip.style.left = Math.min(x + 12, canvas.clientWidth - 160) + 'px';
                tooltip.style.top = (y + 12) + 'px';
            };
            canvas.onmouseleave = function() {
                tooltip.style.display = 'none';
            };
            canvas.onwheel = function(event) {
                event.preventDefault();
                const rect = canvas.getBoundingClientRect();
                const x = event.clientX - rect.left;
                const y = event.clientY - rect.top;
                const plot = state.plot;
                if (!plot || x < plot.left || x > plot.left + plot.width || y < plot.top || y > plot.top + plot.height) {
                    return;
                }
                const anchorA = plot.startA + (x - plot.left) / plot.cellW;
                const anchorB = plot.endB - (y - plot.top) / plot.cellH;
                zoomMesh(event.deltaY < 0 ? 1.25 : 0.8, anchorA, anchorB);
            };
        }

        function updateMeshStats(state) {
            const stats = document.getElementById('meshStats');
            const note = document.getElementById('meshNote');
            const range = heatmapRange(state);
            const info = state.info;
            if (stats) {
                let html = '';
                html += '<div>Grid: ' + state.nA + ' x ' + state.nB + '</div>';
                html += '<div>Slice: ' + AXIS_NAMES[state.normalAxis] + ' index ' + (state.sliceIdx + 1) + ' of ' + info.dims[state.normalAxis] + '</div>';
                html += '<div>Zoom: ' + state.zoom.toFixed(2) + 'x</div>';
                const unitSuffix = state.unitLabel ? ' ' + state.unitLabel : '';
                html += '<div>Min: ' + (isFinite(range.min) ? range.min.toExponential(4) + unitSuffix : 'n/a') + '</div>';
                html += '<div>Max: ' + (isFinite(range.max) ? range.max.toExponential(4) + unitSuffix : 'n/a') + '</div>';
                if (state.colorScale === 'logarithmic') {
                    html += '<div>Min positive: ' + (isFinite(range.minPositive) ? range.minPositive.toExponential(4) + unitSuffix : 'n/a') + '</div>';
                }
                stats.innerHTML = html;
            }
            if (note) {
                const unitSuffix = state.normalize
                    ? (info.nAxes === 1 ? ' per cm' : (info.nAxes === 2 ? ' per cm²' : ' per cm³'))
                    : '';
                let text = 'Values are tally means' + unitSuffix + ', multiplied by the scale factor.';
                if (state.unitLabel) {
                    text += ' Dose values are displayed in ' + state.unitLabel + '; the scale factor is interpreted as the source rate in particles/s.';
                }
                if (state.combinedParentCount > 0) {
                    text += ' Values sum ' + state.combinedParentCount + ' parent nuclides; standard deviations are combined in quadrature without covariance data.';
                }
                if (state.colorScale === 'logarithmic') {
                    text += ' Non-positive bins are shown in grey on a logarithmic colour scale.';
                }
                note.textContent = text;
            }
        }

        function closeModal() {
            const modal = document.getElementById('tallyModal');
            modal.classList.remove('active');
            if (currentChart) {
                currentChart.destroy();
                currentChart = null;
            }
            if (currentProfileChart) {
                currentProfileChart.destroy();
                currentProfileChart = null;
            }
            currentMeshInfo = null;
            currentHeatmap = null;
            currentProfileData = null;
        }
        
        function closeModalOnOverlay(event) {
            if (event.target.id === 'tallyModal') {
                closeModal();
            }
        }
        
        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
        
        // Close modal with Escape key
        document.addEventListener('keydown', function(event) {
            if (event.key === 'Escape') {
                closeModal();
            }
        });
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

    private formatTallyResults(results: { mean: number[], stdDev: number[], shape: number[] }): string {
        const count = results.mean.length;
        if (count === 0) {
            return 'No results';
        }

        if (count <= this.RESULT_DISPLAY_THRESHOLD) {
            return results.mean.map(r => r.toExponential(this.RESULT_EXPONENTIAL_PRECISION)).join(', ');
        }

        let min = Infinity;
        let max = -Infinity;
        for (const value of results.mean) {
            if (!isNaN(value) && isFinite(value) && value !== 0) {
                if (value < min) {
                    min = value;
                }
                if (value > max) {
                    max = value;
                }
            }
        }
        if (!isFinite(min) || !isFinite(max)) {
            return `${count} values (all zero or invalid)`;
        }

        return `${count} values (min: ${min.toExponential(this.RESULT_EXPONENTIAL_PRECISION)}, max: ${max.toExponential(this.RESULT_EXPONENTIAL_PRECISION)})`;
    }

    private escapeHtml(unsafe: string): string {
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    private sanitizeExportFileName(value: string, fallback: string): string {
        const name = path.basename(value).replace(/[^a-zA-Z0-9._-]+/g, '-');
        return name && name !== '.' && name !== '..' ? name : fallback;
    }

    private decodePngDataUrl(value: string): Uint8Array {
        const prefix = 'data:image/png;base64,';
        if (!value.startsWith(prefix)) {
            throw new Error('invalid PNG data');
        }
        return Buffer.from(value.slice(prefix.length), 'base64');
    }
}
