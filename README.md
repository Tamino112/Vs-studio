# Visual Studio Community for macOS (.NET 10 & C#)

A private-use, Copilot-free desktop IDE for **macOS** designed to faithfully replicate **Microsoft Visual Studio Community** (Windows) for **C# & .NET 10** development.

## Features

- **Visual Studio Start Window**: Open recent solutions (with pinning & search), Clone a Git repository, Open a project/solution (`.sln`, `.slnx`, `.csproj`), Open local folder, or Create a new project.
- **Multi-Project Solutions**: Create `.sln` solutions with multiple projects (Console App, ASP.NET Core Web API, Blazor Web App, Class Library, xUnit/NUnit/MSTest, Worker Service, gRPC), set Startup Project, and manage **Project References** (`dotnet add reference`).
- **Authentic Visual Studio UI**:
  - **Themes**: Dark (Default), Classic Blue, and Light.
  - **Menu Bar & Standard/Debug Toolbar**: `Debug`/`Release`, `Any CPU`/`arm64`/`x64`, green ▶ Startup Project runner, Step Into (`F11`), Step Over (`F10`), Step Out (`⇧F11`), Stop (`⇧F5`).
  - **Solution Explorer**: Solution root, bold Startup Project, expandable `Dependencies` (`Frameworks`, `Packages`, `Projects`), Show All Files, Context Menus (Build/Rebuild/Clean/Set as Startup/Add Class/Interface/Record/New Folder/NuGet/Finder).
  - **Monaco C# Editor**: Breadcrumb bar, Breakpoint gutter (`F9`), yellow debug line marker, MSBuild & Roslyn LSP squiggly diagnostics, C# snippets (`cw`, `prop`, `ctor`, `record`, `async`), and optional **C# Language Server (`csharp-ls`)** IntelliSense (Hover, Go to Definition, Rename, Format).
  - **Tool Windows**: Error List, Output (with interactive `stdin`), macOS Developer Terminal, Test Explorer (`dotnet test`), Find in Files (`⇧⌘F`), NuGet Package Manager (Browse & Installed via NuGet.org API), Git Changes (stage/unstage/diff/commit/branch/pull/push), Properties Grid (`.csproj` editor), Locals, Watch, Call Stack, and Breakpoints.
- **No Copilot**: Zero AI chat/Copilot buttons, panels, or telemetry.
- **macOS & Windows Keymaps**: Uses macOS shortcuts (`⌘S`, `⌘B`, `F5`/`⌘R`, `⌘,`) by default, with a toggleable Windows Visual Studio keymap in `Tools -> Options`.

## Prerequisites on macOS

1. **Node.js 20+** and **npm**
2. **.NET 10 SDK** (`dotnet --version`) — install from [dotnet.microsoft.com](https://dotnet.microsoft.com/download/dotnet/10.0) or `brew install --cask dotnet-sdk`
3. *(Optional, for full Roslyn IntelliSense)*:
   ```bash
   dotnet tool install --global csharp-ls
   ```
   *(You can also install `csharp-ls` in one click inside the IDE via `Tools -> Options`)*
4. *(Optional, for step-by-step breakpoint debugging)*:
   ```bash
   brew install netcoredbg
   ```

## Run & Build on macOS

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build native macOS .dmg & .app (Apple Silicon arm64 + Intel x64)
npm run package:mac
```

The packaged macOS `.dmg` and `.app` will be output to `release/`.
