import 'package:flutter/foundation.dart';
import '../models/models.dart';
import '../services/auth_service.dart';
import '../services/data_service.dart';

class AppProvider extends ChangeNotifier {
  final AuthService _authService;
  final DataService _dataService;

  AppProvider(this._authService, this._dataService);

  AuthService get authService => _authService;
  DataService get dataService => _dataService;

  Employee? get currentUser => _authService.currentUser;
  bool get isAdmin => _authService.isAdmin;
  bool get isJunior => _authService.isJunior;
  String? get selectedLocationId => _authService.selectedLocationId;

  Future<void> initialize() async {
    await _authService.initializeFromTelegram();
    notifyListeners();
  }

  void setSelectedLocation(String locationId) {
    _authService.setSelectedLocation(locationId);
    notifyListeners();
  }

  void refresh() {
    notifyListeners();
  }
}
