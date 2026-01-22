# Creating Test Statepoint Files

This guide explains how to create OpenMC statepoint files for testing the extension.

## Prerequisites

You need to have OpenMC installed. Follow the installation instructions at: https://docs.openmc.org/en/stable/usersguide/install.html

## Simple Example

Here's a minimal Python script to generate a statepoint file:

```python
import openmc

# Create materials
water = openmc.Material(name='water')
water.add_nuclide('H1', 2.0)
water.add_nuclide('O16', 1.0)
water.set_density('g/cc', 1.0)

materials = openmc.Materials([water])
materials.export_to_xml()

# Create geometry
sphere = openmc.Sphere(r=10.0, boundary_type='vacuum')
cell = openmc.Cell(fill=water, region=-sphere)
geometry = openmc.Geometry([cell])
geometry.export_to_xml()

# Create settings
settings = openmc.Settings()
settings.batches = 100
settings.inactive = 10
settings.particles = 1000
settings.source = openmc.IndependentSource(space=openmc.stats.Point())

# Add a tally
tallies = openmc.Tallies()
tally = openmc.Tally(name='flux')
tally.scores = ['flux']
tallies.append(tally)
tallies.export_to_xml()

settings.export_to_xml()

# Run the simulation
openmc.run()
```

After running this script, you'll get a `statepoint.100.h5` file that you can open with the extension.

## Using the Extension

1. Open VS Code
2. Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac)
3. Type "OpenMC: Open Statepoint File"
4. Select your `statepoint.100.h5` file
5. View the simulation results!

## Viewing Existing Files

If you already have OpenMC statepoint files from previous simulations:

1. Right-click on any `.h5` file in the VS Code file explorer
2. Select "Open With..."
3. Choose "OpenMC Statepoint Viewer"

## Expected File Structure

OpenMC statepoint files typically contain:
- General simulation information (batches, particles, k-effective)
- Tallies with scores and filters
- Mesh definitions (if mesh tallies are used)
- Global simulation results

The extension will automatically parse and display all available information from the file.
