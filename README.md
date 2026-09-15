# OpenMC VSCode Extension

A Visual Studio Code extension for inspecting OpenMC statepoint files. This extension provides a user-friendly interface to view tallies, meshes, general information, and simulation results from OpenMC HDF5 statepoint files.

## Features

- **Statepoint File Viewer**: Open and inspect OpenMC statepoint files (`.h5`, `.hdf5`)
- **General Information Display**: View simulation parameters, batch information, and runtime data
- **Interactive Tally Inspection**: Click on tallies to view detailed information including:
  - Spectrum visualization with multiple chart types (line, bar, scatter)
  - Logarithmic and linear scale options for both axes
  - Error bars visualization (±σ)
  - Energy-dependent axis labels when energy filters are present
  - Detailed filter information (energy bins, cell IDs, mesh associations)
  - Results data table with mean, standard deviation, and relative error
- **2D Mesh Slice Histograms**: View mesh tallies as a 2D heatmap with:
  - Selectable coordinate plane (XY, XZ, YZ) and slice index along the remaining axis
  - Score, nuclide and energy/other filter bin selection
  - Optional normalization by mesh element volume
  - A user-defined scale factor (normalization constant)
  - Parent-nuclide selection by isotope name, including a combined view that sums all parents
  - Independent dose and time units, allowing combinations such as pSv/s, mSv/h or Sv/s
  - Zoom controls and mouse-wheel zoom for inspecting dense meshes
  - Linear or logarithmic colour scale with colour bar, plus hover tooltips showing coordinates, value, σ and relative error
  - Coordinate-aware 1D line profiles through 1D, 2D or 3D meshes
- **Mesh Visualization**: Examine mesh definitions including dimensions and spatial bounds
- **Summary Statistics**: View key simulation metrics like k-effective and entropy
- **Depletion Results Viewer**: Open and inspect OpenMC depletion results files (e.g. `depletion_results.h5`) to see:
  - Overview: format version, number of time steps, total depletion time, materials, nuclides and tracked reactions
  - Time step table with time (s and days), k-effective ± σ, source rate and depletion (wall-clock) time
  - k-effective evolution chart
  - Material composition at any time step (atoms, atom density in atom/b-cm, and atom fraction)
  - Nuclide search in both the composition table and the evolution chart — filter by element (`Pu`), mass number (`137`) or full name (`Cs137`), and combine several terms
  - Evolution chart that overlays multiple nuclides at once, with an optional logarithmic axis
  - Combined-material composition and evolution views that sum inventories across all materials or mesh voxels
  - Per-nuclide activity in Bq using half-lives from the depletion chain configured by `OPENMC_CHAIN_FILE`
  - Sortable material-composition columns and a **Show all** action for inspecting the complete depletion nuclide inventory
  - Total activity for the selected depletion material or combined material inventory
- **User-Friendly Interface**: Clean, VSCode-themed interface with organized sections

## Installation

### From VSIX
1. Download the `.vsix` file
2. Open VSCode
3. Go to Extensions view (Ctrl+Shift+X)
4. Click the "..." menu at the top
5. Select "Install from VSIX..."
6. Choose the downloaded `.vsix` file

### From Source
```bash
# Clone the repository
git clone https://github.com/Villadslj/openmc-vscode-extension.git
cd openmc-vscode-extension

# Install dependencies
npm install

# Compile the extension
npm run compile

# Package the extension (optional)
npm run package
```

## Usage

### Opening Statepoint Files

There are two ways to open statepoint files:

1. **Command Palette Method**:
   - Press `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (Mac)
   - Type "OpenMC: Open Statepoint File"
   - Select your `.h5` or `.hdf5` file

2. **File Explorer Method**:
   - Right-click on an `.h5` file in the VSCode file explorer
   - Select "Open With..."
   - Choose "OpenMC Statepoint Viewer"

### Opening Depletion Results Files

1. **Command Palette Method**:
   - Press `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (Mac)
   - Type "OpenMC: Open Depletion Results File"
   - Select your `depletion_results.h5` file

2. **File Explorer Method**:
   - Files whose name contains `depletion` (e.g. `depletion_results.h5`) open in the depletion viewer directly
   - For other names, right-click the `.h5` file, select "Open With..." and choose "OpenMC Statepoint Viewer" — depletion files are detected from their contents and shown in the depletion viewer automatically

### Filtering Nuclides

Both the **Material Composition** table and the **Nuclide Evolution** chart have a search box:

| Query | Matches |
| --- | --- |
| `Pu` | every plutonium isotope (element symbol prefix) |
| `137` | every nuclide with mass number 137 (`Cs137`, `Ba137`, `Xe137`, …) |
| `Cs137` | that nuclide and its metastable states |
| `Am242_m1` | only that metastable state |
| `U235 Pu239 Cs137` | any of the listed nuclides (terms are separated by spaces or commas) |

In **Nuclide Evolution**, tick any number of nuclides to overlay them on the chart, use **Add matching** to add the current search results in one go, and remove a nuclide by clicking the `×` on its chip.

Both **Material Composition** and **Nuclide Evolution** include a **Combined (all materials)** option. It sums atom inventories across every material or activation-mesh voxel. Combined atom density uses the sum of all material volumes and is unavailable if any included volume is missing.

The **Activity (Bq)** column requires `OPENMC_CHAIN_FILE` to point to the depletion chain XML used by the calculation. Nuclides without a `half_life` attribute in that chain are treated as stable. If the variable is missing or unreadable, the viewer keeps the column visible and reports that the chain file is required.

The material-composition table reads nuclides directly from the depletion result `/nuclides` index, including activation products that do not have neutron transport cross sections. Click any column header to sort ascending or descending. The default sort is activity descending when chain data is available, otherwise atoms descending. Use **Show all** to remove the display row limit.

The 1D mesh profile and 2D mesh heatmap can export their current numerical values as CSV or save the rendered plot as a PNG through the VS Code Save dialog.

### Viewing Information

Once a statepoint file is opened, you'll see:

- **General Information**: Simulation parameters, version, number of particles, batches, etc.
- **Tallies**: List of all tallies with their properties and results (click to see detailed view)
- **Meshes**: Details about mesh definitions used in the simulation
- **Summary Statistics**: Key results like k-effective value

### Tally Detail View

Click on any tally to open a detailed modal view with:

- **Basic Information**: Tally ID, name, estimator type, and number of score bins
- **Scores and Nuclides**: Lists of score types and nuclides being tracked
- **Filter Details**: Information about filters applied to the tally, including:
  - Energy filter bins (in eV)
  - Cell filter IDs
  - Mesh filter associations
- **Spectrum Visualization**: Interactive chart with controls for:
  - Chart type (line, bar, scatter)
  - Y-axis scale (logarithmic/linear)
  - X-axis scale (logarithmic/linear)
  - Error bars toggle
- **Mesh Slice (2D)**: Shown for tallies with a mesh filter (regular or rectilinear meshes with at least two axes of more than one element):
  - **Plane**: choose XY, XZ or YZ; only planes with more than one element on both axes are offered
  - **Slice**: choose the index along the remaining axis, labelled with its physical coordinate range
  - **Filter/nuclide/score selectors**: shown whenever the tally has more than one bin for them, so a single 2D field is displayed
  - **Normalize by volume**: divides each bin by its mesh element volume (cm³), area (cm²), or length (cm); enabled by default for recognized dose tallies
  - **Scale factor**: an arbitrary multiplier applied after normalization (invalid input falls back to 1); for dose-rate units this is interpreted as the source rate in particles/s
  - **Parent nuclide**: select an isotope by name or combine all parent-nuclide bins
  - **Dose and time units**: choose the dose magnitude (pSv, nSv, µSv, mSv or Sv) and time denominator (s, min, h or day) independently
  - **Zoom**: use the zoom buttons or mouse wheel over the heatmap; reset restores the full mesh
  - **Colour scale**: linear or logarithmic, with a colour bar and min/max readout; non-positive bins are greyed out on a logarithmic scale
  - Hover any cell for its indices, physical centre coordinates, value, standard deviation and relative error
- **Mesh Line Profile (1D)**:
  - Choose X, Y or Z as the profile axis and select an index/coordinate on each remaining mesh axis
  - Uses the same parent-nuclide combination, nuclide, score, volume normalization, scale factor, and dose/time unit controls as the 2D view
  - Works for 1D meshes as well as lines through 2D and 3D meshes
  - The accompanying results table shows mesh index, physical coordinate and bounds, mean, standard deviation, and relative error for the selected line instead of ambiguous flattened mesh-bin numbers
- **Results Data Table**: Non-mesh tallies retain the general bin table; mesh tallies use the coordinate-aware line-profile table

## Requirements

- Visual Studio Code 1.108.0 or higher
- Node.js 18 or higher (only needed to build from source)
- OpenMC statepoint or depletion results files in HDF5 format

## Extension Settings

This extension does not add any VSCode settings at this time.

## Known Issues

- Large statepoint files may take some time to load
- Some advanced OpenMC features may not be fully displayed yet

## Development

### Building
```bash
npm run compile
```

### Packaging
```bash
npm run package
```

### Running in Development
1. Open the project in VSCode
2. Run `npm install` if you have not already
3. Press F5 to launch the **Run Extension** configuration in a new Extension Development Host window
4. Test the extension with sample statepoint files

The `F5` launch compiles the extension first via the `npm: compile` task. Use `npm run watch` in a
terminal if you prefer incremental rebuilds while the host window stays open.

## Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.

## License

MIT

## Credits

This extension uses:
- [h5wasm](https://github.com/usnistgov/h5wasm) for reading HDF5 files
- VSCode Extension API

## Support

For issues and feature requests, please visit the [GitHub repository](https://github.com/Villadslj/openmc-vscode-extension).
