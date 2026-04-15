# OpenMC VSCode Extension

A Visual Studio Code extension for inspecting OpenMC statepoint files. This extension provides a user-friendly interface to view tallies, meshes, general information, and simulation results from OpenMC HDF5 statepoint files.

## Features

- **Statepoint File Viewer**: Open and inspect OpenMC statepoint files (`.h5`, `.hdf5`)
- **Surface Source File Viewer**: Open and inspect OpenMC `surface_source.h5` files with energy spectra
- **General Information Display**: View simulation parameters, batch information, and runtime data
- **Interactive Tally Inspection**: Click on tallies to view detailed information including:
  - Spectrum visualization with multiple chart types (line, bar, scatter)
  - Logarithmic and linear scale options for both axes
  - Error bars visualization (±σ)
  - Energy-dependent axis labels when energy filters are present
  - Detailed filter information (energy bins, cell IDs, mesh associations)
  - Results data table with mean, standard deviation, and relative error
- **Mesh Visualization**: Examine mesh definitions including dimensions and spatial bounds
- **Summary Statistics**: View key simulation metrics like k-effective and entropy
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

### Opening Surface Source Files

Surface source files (`surface_source.h5`) are detected automatically when opened:

1. **Auto-open**: Files named `surface_source.h5` open in the Surface Source Viewer by default when double-clicked in the file explorer.
2. **Command Palette**: Press `Ctrl+Shift+P`, type `OpenMC: Open Surface Source File`, and select the file.
3. **Open With**: Right-click any `.h5` file → `Open With...` → `OpenMC Surface Source Viewer`.

The Surface Source Viewer shows:
- **Summary**: Total particle count broken down by neutron, photon, and other types.
- **Neutron Energy Spectrum**: 100-bin log-spaced histogram from 1×10⁻⁵ eV to 2×10⁷ eV (20 MeV).
- **Photon Energy Spectrum**: Same range and resolution.
- **Interactive controls**: Toggle logarithmic/linear scale on each axis.

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
- **Results Data Table**: Detailed table showing bin index, x-value, mean, standard deviation, and relative error

## Requirements

- Visual Studio Code 1.75.0 or higher
- OpenMC statepoint files in HDF5 format

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
2. Press F5 to launch the extension in a new Extension Development Host window
3. Test the extension with sample statepoint files

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
