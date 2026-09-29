# Third-Party Notices

## GTNH Calculator

Portions of the binary repository parser, machine definitions, voltage tiers,
choice handling, and overclock calculation are adapted from:

https://github.com/ShadowTheAge/gtnh

MIT License

Copyright (c) 2025 ShadowTheAge

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## GTNH Data

GTNH recipe data and icon atlases are downloaded by the user from:

https://github.com/ShadowTheAge/gtnh-data

The data repository contains assets and textual content derived from
Minecraft, GTNH, and other mods. It is not bundled or redistributed with this
application and is downloaded only after the user chooses a data revision.

## NESQL Exporter

The optional local game-instance importer includes two builds of
`ShadowTheAge/nesql-exporter` and their corresponding source archives:

- GTNH 2.9.x: commit `b5b896ebd9bcf4cfe1f4fad19ccdc7de8414ee57`, version
  `0.5.7-ShadowTheAge`
- GTNH 2.8.4: commit `9f467e16ad40bfa4e7ff042e986579b1d416a9ea`, version
  `0.5.6-ShadowTheAge`

The bundled NESQL builds include a small compatibility patch that selects the
JDK logging provider. GTNH ships Log4j 2 beta, whose API is incompatible with
the JBoss Log4j2 bridge used by NESQL's Hibernate version. Without this patch,
recipe post-processing repeatedly throws `NoSuchMethodError` and can spend all
of its time handling logging failures.

The exporter is licensed under GNU LGPL version 3. Its license and source
archives are stored beside the JARs in `resources/integrations/` and
`resources/integrations/nesql/2.8.4/`.

https://github.com/ShadowTheAge/nesql-exporter
