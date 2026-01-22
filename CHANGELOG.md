# Change Log

All notable changes to the OpenMC VSCode Extension will be documented in this file.

## [0.1.0] - 2024-01-22

### Added
- Initial release of OpenMC Statepoint Inspector
- Custom editor for opening and viewing OpenMC statepoint HDF5 files
- Display general simulation information (version, particles, batches, etc.)
- View tallies with their IDs, scores, filters, and results
- View meshes with dimensions and spatial bounds
- Display summary statistics including k-effective
- Basic plotting capabilities with Chart.js for visualizing tally results
- Command palette integration for opening statepoint files
- Context menu integration for HDF5 files
- VSCode theme-aware UI with dark mode support

### Features
- **Statepoint File Viewer**: Open and inspect OpenMC statepoint files (`.h5`, `.hdf5`)
- **General Information Display**: View simulation parameters and runtime data
- **Tally Inspection**: Browse all tallies with their properties
- **Mesh Visualization**: Examine mesh definitions
- **Summary Statistics**: View key simulation metrics
- **Basic Charts**: Visualize tally results with bar charts
- **User-Friendly Interface**: Clean, VSCode-themed interface

## [Unreleased]

### Planned Features
- Enhanced plotting options (line charts, scatter plots)
- 3D mesh visualization
- Export data to CSV/JSON
- Compare multiple statepoint files
- Filter and search tallies
- Custom color themes for plots
