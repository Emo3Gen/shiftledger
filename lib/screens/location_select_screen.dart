import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/app_provider.dart';

class LocationSelectScreen extends StatelessWidget {
  const LocationSelectScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final appProvider = Provider.of<AppProvider>(context);
    final locations = appProvider.dataService.getLocations();

    if (locations.length == 1) {
      // Auto-select if only one location
      WidgetsBinding.instance.addPostFrameCallback((_) {
        appProvider.setSelectedLocation(locations.first.id);
        Navigator.of(context).pushReplacementNamed('/week');
      });
      return const Scaffold(
        body: Center(child: CircularProgressIndicator()),
      );
    }

    return Scaffold(
      appBar: AppBar(
        title: const Text('Выбор объекта'),
      ),
      body: ListView.builder(
        itemCount: locations.length,
        itemBuilder: (context, index) {
          final location = locations[index];
          return ListTile(
            title: Text(location.name),
            subtitle: Text(location.city),
            trailing: const Icon(Icons.chevron_right),
            onTap: () {
              appProvider.setSelectedLocation(location.id);
              Navigator.of(context).pushReplacementNamed('/week');
            },
          );
        },
      ),
    );
  }
}
