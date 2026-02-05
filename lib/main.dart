import 'package:flutter/material.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:provider/provider.dart';

import 'providers/app_provider.dart';
import 'screens/location_select_screen.dart';
import 'screens/payroll_screen.dart';
import 'screens/settings_screen.dart';
import 'screens/week_screen.dart';
import 'services/auth_service.dart';
import 'services/data_service.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await initializeDateFormatting('ru', null);
  runApp(const ShiftLedgerApp());
}

class ShiftLedgerApp extends StatelessWidget {
  const ShiftLedgerApp({super.key});

  @override
  Widget build(BuildContext context) {
    // Initialize services
    final dataService = DataService();
    final authService = AuthService(dataService);
    final appProvider = AppProvider(authService, dataService);

    return ChangeNotifierProvider.value(
      value: appProvider,
      child: MaterialApp(
        title: 'ShiftLedger',
        theme: ThemeData(
          colorScheme: ColorScheme.fromSeed(seedColor: Colors.blue),
          useMaterial3: true,
        ),
        home: const InitializationScreen(),
        routes: {
          '/location': (context) => const LocationSelectScreen(),
          '/week': (context) => const WeekScreen(),
          '/payroll': (context) => const PayrollScreen(),
          '/settings': (context) => const SettingsScreen(),
        },
      ),
    );
  }
}

class InitializationScreen extends StatefulWidget {
  const InitializationScreen({super.key});

  @override
  State<InitializationScreen> createState() => _InitializationScreenState();
}

class _InitializationScreenState extends State<InitializationScreen> {
  @override
  void initState() {
    super.initState();
    _initialize();
  }

  Future<void> _initialize() async {
    final appProvider = Provider.of<AppProvider>(context, listen: false);
    await appProvider.initialize();

    if (!mounted) {
      return;
    }

    final locations = appProvider.dataService.getLocations();
    if (locations.length > 1) {
      if (mounted) {
        await Navigator.of(context).pushReplacementNamed('/location');
      }
    } else {
      if (mounted) {
        await Navigator.of(context).pushReplacementNamed('/week');
      }
    }
  }

  @override
  Widget build(BuildContext context) => const Scaffold(
        body: Center(
          child: CircularProgressIndicator(),
        ),
      );
}
