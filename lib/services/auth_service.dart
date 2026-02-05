import '../models/models.dart';
import 'data_service.dart';

class AuthService {
  final DataService _dataService;
  Employee? _currentUser;
  String? _selectedLocationId;

  AuthService(this._dataService);

  Employee? get currentUser => _currentUser;
  String? get selectedLocationId => _selectedLocationId;
  bool get isAdmin => _currentUser?.role == 'admin';
  bool get isJunior => _currentUser?.role == 'junior';

  // Mock Telegram auth - in real app, parse initData from Telegram WebApp
  Future<void> initializeFromTelegram({String? mockUserId}) async {
    // In MVP: mock authentication
    // In production: parse Telegram WebApp.initData
    
    // Default to admin for MVP, or use mockUserId
    final userId = mockUserId ?? 'emp_admin';
    _currentUser = _dataService.getEmployeeById(userId);
    
    // Set default location
    final locations = _dataService.getLocations();
    if (locations.isNotEmpty) {
      _selectedLocationId = locations.first.id;
    }
  }

  void setSelectedLocation(String locationId) {
    _selectedLocationId = locationId;
  }

  bool canEditShift(Shift shift) {
    if (isAdmin) return true;
    if (isJunior && shift.actualEmployeeId == _currentUser?.id) {
      return true; // Can mark cleaning/extra classes
    }
    return false;
  }

  bool canMarkCleaning(Shift shift) {
    return isJunior && shift.actualEmployeeId == _currentUser?.id;
  }

  bool canAddExtraClass(Shift shift) {
    return isJunior && shift.actualEmployeeId == _currentUser?.id;
  }
}
