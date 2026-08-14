import Notification from '../models/Notification.js';

// GET /api/notifications – latest 50 for the logged-in account, newest first.
export const getNotifications = async (req, res) => {
  try {
    const recipientModel = req.userRole === 'Employee' ? 'Employee' : 'User';
    const notifications = await Notification.find({
      tenantId: req.tenantId,
      recipientId: req.user._id,
      recipientModel,
    }).sort({ createdAt: -1 }).limit(50);

    const unreadCount = await Notification.countDocuments({
      tenantId: req.tenantId,
      recipientId: req.user._id,
      recipientModel,
      read: false,
    });

    res.json({ success: true, data: { notifications, unreadCount } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/notifications/:id/read
export const markNotificationRead = async (req, res) => {
  try {
    const recipientModel = req.userRole === 'Employee' ? 'Employee' : 'User';
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, tenantId: req.tenantId, recipientId: req.user._id, recipientModel },
      { read: true },
      { new: true }
    );
    if (!notification) return res.status(404).json({ success: false, message: 'Notification not found.' });
    res.json({ success: true, data: notification });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/notifications/read-all
export const markAllNotificationsRead = async (req, res) => {
  try {
    const recipientModel = req.userRole === 'Employee' ? 'Employee' : 'User';
    await Notification.updateMany(
      { tenantId: req.tenantId, recipientId: req.user._id, recipientModel, read: false },
      { read: true }
    );
    res.json({ success: true, message: 'All notifications marked as read.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
