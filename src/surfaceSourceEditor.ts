import * as vscode from 'vscode';
import * as path from 'path';
import { SurfaceSourceParser, SurfaceSourceData } from './surfaceSourceParser';

export class SurfaceSourceEditorProvider implements vscode.CustomReadonlyEditorProvider {

    constructor(private readonly context: vscode.ExtensionContext) {}

    async openCustomDocument(
        uri: vscode.Uri,
        _openContext: vscode.CustomDocumentOpenContext,
        _token: vscode.CancellationToken
    ): Promise<vscode.CustomDocument> {
        return { uri, dispose: () => {} };
    }

    async resolveCustomEditor(
        document: vscode.CustomDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.file(path.join(this.context.extensionPath, 'node_modules'))
            ]
        };

        try {
            const parser = new SurfaceSourceParser();
            const data = await parser.parseFile(document.uri.fsPath);
            webviewPanel.webview.html = this.getWebviewContent(data, document.uri, webviewPanel.webview);
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            webviewPanel.webview.html = this.getErrorContent(msg);
        }
    }

    // -------------------------------------------------------------------------
    // Webview HTML
    // -------------------------------------------------------------------------

    private getWebviewContent(
        data: SurfaceSourceData,
        uri: vscode.Uri,
        webview: vscode.Webview
    ): string {
        const fileName = path.basename(uri.fsPath);

        const chartJsPath = vscode.Uri.file(
            path.join(this.context.extensionPath, 'node_modules', 'chart.js', 'dist', 'chart.umd.js')
        );
        const chartJsUri = webview.asWebviewUri(chartJsPath);

        // Serialise spectra as JSON for injection into the script
        const neutronJson = JSON.stringify(data.neutronSpectrum);
        const photonJson  = JSON.stringify(data.photonSpectrum);

        const warningHtml = data.errorMessage
            ? `<div class="warning-box">⚠️ ${this.escapeHtml(data.errorMessage)}</div>`
            : '';

        const surfaceIdsText = data.surfaceIds.length > 0
            ? this.escapeHtml(data.surfaceIds.join(', '))
            : 'N/A';

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${webview.cspSource} 'unsafe-inline'; style-src ${webview.cspSource} 'unsafe-inline';">
    <title>OpenMC Surface Source Viewer</title>
    <script src="${chartJsUri}"></script>
    <style>
        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 20px;
            line-height: 1.6;
        }
        h1, h2 {
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
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 12px;
            margin-top: 10px;
        }
        .stat-card {
            padding: 12px 16px;
            background-color: var(--vscode-editor-background);
            border-left: 3px solid var(--vscode-textLink-foreground);
            border-radius: 3px;
        }
        .stat-label {
            font-weight: bold;
            color: var(--vscode-textLink-foreground);
            font-size: 0.85em;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
        .stat-value {
            font-size: 1.4em;
            margin-top: 4px;
        }
        .chart-section {
            margin-bottom: 30px;
        }
        .chart-section h2 {
            margin-top: 0;
        }
        .chart-controls {
            display: flex;
            gap: 15px;
            margin-bottom: 12px;
            flex-wrap: wrap;
            align-items: center;
        }
        .chart-controls label {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 0.9em;
        }
        .chart-controls select {
            padding: 4px 8px;
            border-radius: 3px;
            border: 1px solid var(--vscode-panel-border);
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
        }
        .chart-wrapper {
            position: relative;
            height: 380px;
            width: 100%;
            background-color: var(--vscode-editor-background);
            border-radius: 4px;
            padding: 10px;
            box-sizing: border-box;
        }
        .warning-box {
            padding: 12px 16px;
            background-color: var(--vscode-inputValidation-warningBackground);
            border: 1px solid var(--vscode-inputValidation-warningBorder);
            border-radius: 4px;
            margin-bottom: 20px;
        }
        .particle-neutron { color: #4fc3f7; }
        .particle-photon  { color: #f48fb1; }
    </style>
</head>
<body>
    <h1>OpenMC Surface Source File: ${this.escapeHtml(fileName)}</h1>
    ${warningHtml}

    <div class="section">
        <h2>Summary</h2>
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-label">Total Particles</div>
                <div class="stat-value">${data.totalParticles.toLocaleString()}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Neutrons</div>
                <div class="stat-value particle-neutron">${data.neutronSpectrum.totalParticles.toLocaleString()}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Photons</div>
                <div class="stat-value particle-photon">${data.photonSpectrum.totalParticles.toLocaleString()}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Other / Unknown</div>
                <div class="stat-value">${data.otherParticleCount.toLocaleString()}</div>
            </div>
            ${data.fileVersion ? `
            <div class="stat-card">
                <div class="stat-label">OpenMC Version</div>
                <div class="stat-value">${this.escapeHtml(data.fileVersion)}</div>
            </div>` : ''}
            <div class="stat-card">
                <div class="stat-label">Surface IDs</div>
                <div class="stat-value" style="font-size:1em;">${surfaceIdsText}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Energy Range</div>
                <div class="stat-value" style="font-size:0.95em;">1×10⁻⁵ eV – 2×10⁷ eV</div>
            </div>
        </div>
    </div>

    <!-- Neutron spectrum -->
    ${data.neutronSpectrum.totalParticles > 0 ? `
    <div class="section chart-section">
        <h2>🔵 Neutron Energy Spectrum (${data.neutronSpectrum.totalParticles.toLocaleString()} particles)</h2>
        <div class="chart-controls">
            <label>Y-Axis:
                <select id="neutronYScale">
                    <option value="logarithmic">Logarithmic</option>
                    <option value="linear">Linear</option>
                </select>
            </label>
            <label>X-Axis:
                <select id="neutronXScale">
                    <option value="logarithmic">Logarithmic</option>
                    <option value="linear">Linear</option>
                </select>
            </label>
        </div>
        <div class="chart-wrapper"><canvas id="neutronChart"></canvas></div>
    </div>
    ` : `<div class="section"><h2>🔵 Neutron Energy Spectrum</h2><p style="color:var(--vscode-descriptionForeground);font-style:italic;">No neutron particles found in this file.</p></div>`}

    <!-- Photon spectrum -->
    ${data.photonSpectrum.totalParticles > 0 ? `
    <div class="section chart-section">
        <h2>🔴 Photon Energy Spectrum (${data.photonSpectrum.totalParticles.toLocaleString()} particles)</h2>
        <div class="chart-controls">
            <label>Y-Axis:
                <select id="photonYScale">
                    <option value="logarithmic">Logarithmic</option>
                    <option value="linear">Linear</option>
                </select>
            </label>
            <label>X-Axis:
                <select id="photonXScale">
                    <option value="logarithmic">Logarithmic</option>
                    <option value="linear">Linear</option>
                </select>
            </label>
        </div>
        <div class="chart-wrapper"><canvas id="photonChart"></canvas></div>
    </div>
    ` : `<div class="section"><h2>🔴 Photon Energy Spectrum</h2><p style="color:var(--vscode-descriptionForeground);font-style:italic;">No photon particles found in this file.</p></div>`}

    <script>
        const neutronSpectrum = ${neutronJson};
        const photonSpectrum  = ${photonJson};
        const charts = {};

        // Apply Chart.js defaults once fonts are accessible
        document.addEventListener('DOMContentLoaded', function() {
            const style = getComputedStyle(document.body);
            Chart.defaults.color       = style.getPropertyValue('--vscode-foreground')    || '#cccccc';
            Chart.defaults.borderColor = style.getPropertyValue('--vscode-panel-border')  || '#444444';

            renderChart('neutron');
            renderChart('photon');

            // Attach scale-change event listeners (avoids inline onchange attributes)
            ['neutronYScale', 'neutronXScale'].forEach(function(id) {
                var el = document.getElementById(id);
                if (el) { el.addEventListener('change', function() { renderChart('neutron'); }); }
            });
            ['photonYScale', 'photonXScale'].forEach(function(id) {
                var el = document.getElementById(id);
                if (el) { el.addEventListener('change', function() { renderChart('photon'); }); }
            });
        });

        function midpoints(edges) {
            const mids = [];
            for (let i = 0; i < edges.length - 1; i++) {
                mids.push(Math.sqrt(edges[i] * edges[i + 1])); // geometric midpoint
            }
            return mids;
        }

        function renderChart(type) {
            const spectrum    = type === 'neutron' ? neutronSpectrum : photonSpectrum;
            const canvasId    = type === 'neutron' ? 'neutronChart'  : 'photonChart';
            const yScaleId    = type === 'neutron' ? 'neutronYScale' : 'photonYScale';
            const xScaleId    = type === 'neutron' ? 'neutronXScale' : 'photonXScale';
            const color       = type === 'neutron' ? 'rgba(79,195,247,' : 'rgba(244,143,177,';

            const canvas = document.getElementById(canvasId);
            if (!canvas) { return; }

            const yScaleEl = document.getElementById(yScaleId);
            const xScaleEl = document.getElementById(xScaleId);
            const yScale = yScaleEl ? yScaleEl.value : 'logarithmic';
            const xScale = xScaleEl ? xScaleEl.value : 'logarithmic';

            // Destroy previous chart instance
            if (charts[type]) {
                charts[type].destroy();
                charts[type] = null;
            }

            const xMids = midpoints(spectrum.binEdges);
            const counts = spectrum.counts;

            // Build data points in a single pass; skip zero bins for log y-scale
            const dataPoints = [];
            for (let i = 0; i < xMids.length; i++) {
                if (yScale === 'logarithmic' && counts[i] === 0) { continue; }
                dataPoints.push({ x: xMids[i], y: counts[i] });
            }

            const datasets = [{
                label: (type === 'neutron' ? 'Neutron' : 'Photon') + ' Count',
                data: dataPoints,
                backgroundColor: color + '0.5)',
                borderColor:     color + '1)',
                borderWidth: 1.5,
                pointRadius: 0,
                stepped: false,
            }];

            charts[type] = new Chart(canvas, {
                type: 'scatter',
                data: { datasets: datasets },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: false,
                    plugins: {
                        legend: { display: false },
                        title: {
                            display: true,
                            text: (type === 'neutron' ? 'Neutron' : 'Photon') + ' Energy Spectrum'
                        },
                        tooltip: {
                            callbacks: {
                                label: function(ctx) {
                                    return 'E = ' + ctx.parsed.x.toExponential(3) + ' eV, count = ' + ctx.parsed.y;
                                }
                            }
                        }
                    },
                    scales: {
                        x: {
                            type: xScale,
                            title: { display: true, text: 'Energy (eV)' },
                            ticks: {
                                maxTicksLimit: 8,
                                callback: function(v) {
                                    return typeof v === 'number' ? v.toExponential(1) : v;
                                }
                            }
                        },
                        y: {
                            type: yScale,
                            title: { display: true, text: 'Particle Count' },
                            ticks: {
                                callback: function(v) { return v; }
                            }
                        }
                    }
                }
            });
        }
    </script>
</body>
</html>`;
    }

    private getErrorContent(errorMessage: string): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Error Loading Surface Source File</title>
    <style>
        body { font-family: var(--vscode-font-family); color: var(--vscode-foreground);
               background-color: var(--vscode-editor-background); padding: 20px; }
        .error-container { padding: 20px;
            background-color: var(--vscode-inputValidation-errorBackground);
            border: 1px solid var(--vscode-inputValidation-errorBorder); border-radius: 5px; }
        h1 { color: var(--vscode-errorForeground); }
        pre { background-color: var(--vscode-editor-background); padding: 10px;
              border-radius: 3px; overflow-x: auto; }
    </style>
</head>
<body>
    <div class="error-container">
        <h1>Error Loading Surface Source File</h1>
        <p>An error occurred while parsing the file:</p>
        <pre>${this.escapeHtml(errorMessage)}</pre>
        <p>Please ensure the file is a valid OpenMC <code>surface_source.h5</code> HDF5 file.</p>
    </div>
</body>
</html>`;
    }

    // -------------------------------------------------------------------------
    // Utilities
    // -------------------------------------------------------------------------

    private escapeHtml(unsafe: string): string {
        return unsafe
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
}
