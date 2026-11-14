# City surface textures

The six JPG maps in this folder are 1K versions of two Poly Haven assets, downloaded from Poly Haven's official asset API on 2026-11-14. Both assets are released under **CC0 1.0 (public domain)**, including redistribution and commercial use.

| Asset | Files | Source |
| --- | --- | --- |
| Asphalt 02 | `asphalt_02_diff.jpg`, `asphalt_02_rough.jpg`, `asphalt_02_normal.jpg` | https://polyhaven.com/a/asphalt_02 |
| Rough Concrete | `rough_concrete_diff.jpg`, `rough_concrete_rough.jpg`, `rough_concrete_normal.jpg` | https://polyhaven.com/a/rough_concrete |

License: https://polyhaven.com/license

All files are the official 1K JPG diffuse, roughness and OpenGL normal maps. Downloaded bytes were checked against MD5 values returned by `https://api.polyhaven.com/files/{asset}`. The game samples these maps with repeating world-space coordinates; no displacement maps are used, so voxel geometry and destruction remain unchanged.
