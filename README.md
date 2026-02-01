# ShiftLedger

A Flutter web application for shift management and payroll calculation in a daycare center.

## Overview

ShiftLedger is a mobile-first Flutter Web app designed to work as a Telegram Mini App. It provides:

- **Shift Management**: Track employee shifts (morning/evening slots)
- **Cleaning Records**: Monitor and record cleaning tasks with automatic flagging for unplanned cleanings
- **Extra Classes**: Track additional paid classes and calculate compensation based on children count
- **Payroll Calculation**: Automated salary calculation combining:
  - Base hourly pay
  - Cleaning task bonuses
  - Extra class earnings

## Features

### For Administrators
- View and manage all shifts in a week grid
- Assign employees to shifts
- Edit shift hours and notes
- Record cleaning tasks and extra classes
- View detailed salary breakdowns
- Configure cleaning rules and extra class types
- Manage employee information and rates

### For Employees
- View personal weekly schedule
- Mark cleaning tasks as completed
- Log extra classes taught
- View personal salary calculation

## Project Structure

```
lib/
├── main.dart           # Entry point
├── models/            # Data models
└── ... (screens, services, utils)
```

## Getting Started

### Prerequisites
- Flutter SDK 3.0+
- Dart 3.0+

### Installation

```bash
flutter pub get
flutter run -d web
```

## Architecture

- **Models**: Core data structures (Employee, Shift, CleaningRecord, etc.)
- **Services**: Business logic and data management
- **UI**: Mobile-first widget-based interface
- **State Management**: Provider pattern for reactive updates

## Data Models

- **Location**: Office/daycare location
- **Employee**: Staff member with role and rates
- **Shift**: Work schedule entry
- **CleaningRecord**: Cleaning task completion
- **ExtraClassRecord**: Additional class with payment
- **ExtraClassType**: Available class types and rates

## Current Status

This is an MVP (Minimum Viable Product) with mock data. Ready for further development in Cursor IDE.

## License

Private project

## Author

Emo3Gen
