import * as vscode from 'vscode';
import * as path from 'path';
import { StatepointParser, TallyData, TallyFilter, StatepointData } from './statepointParser';

export class StatepointEditorProvider implements vscode.CustomReadonlyEditorProvider {
    // Constants for data visualization
    private readonly MAX_CHART_DATA_POINTS = 500;
    private readonly RESULT_DISPLAY_THRESHOLD = 5;
    private readonly RESULT_EXPONENTIAL_PRECISION = 4;
    private readonly MAX_TABLE_ROWS = 100;
    private readonly MAX_INLINE_ENERGY_BINS = 50;
    
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
            localResourceRoots: [
                vscode.Uri.file(path.join(this.context.extensionPath, 'node_modules'))
            ]
        };

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
                    const validMean = mean.filter(function(v) { return !isNaN(v) && isFinite(v); });
                    if (validMean.length > 0) {
                        const minVal = Math.min.apply(null, validMean);
                        const maxVal = Math.max.apply(null, validMean);
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
                    
                    html += '</li>';
                });
                html += '</ul>';
                html += '</div>';
            }
            
            // Chart section
            if (tally.results && tally.results.mean && tally.results.mean.length > 0) {
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
            if (tally.results && tally.results.mean && tally.results.mean.length > 0) {
                setTimeout(function() { updateChart(index); }, 100);
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
        
        function closeModal() {
            const modal = document.getElementById('tallyModal');
            modal.classList.remove('active');
            if (currentChart) {
                currentChart.destroy();
                currentChart = null;
            }
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
        
        const validMean = results.mean.filter(v => !isNaN(v) && isFinite(v) && v !== 0);
        if (validMean.length === 0) {
            return `${count} values (all zero or invalid)`;
        }
        
        if (count <= this.RESULT_DISPLAY_THRESHOLD) {
            return results.mean.map(r => r.toExponential(this.RESULT_EXPONENTIAL_PRECISION)).join(', ');
        }
        
        const min = Math.min(...validMean);
        const max = Math.max(...validMean);
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
}
