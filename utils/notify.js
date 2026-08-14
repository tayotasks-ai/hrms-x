import Notification from '../models/Notification.js';

// Fire-and-forget in-app notification, mirroring the existing sendEmail
// fire-and-forget pattern used across controllers. Never let a notification
// failure break the actual request it's attached to.
export const notify = ({ tenantId, recipientId, recipientModel, type, title, message, link }) => {
  Notification.create({ tenantId, recipientId, recipientModel, type, title, message, link })
    .catch(err => console.error('Notification create failed:', err.message));
};

// Convenience for notifying every HR Admin in a tenant at once (leave
// requests, etc. — same audience pattern already used for email fan-out).
export const notifyHrAdmins = async (User, tenantId, { type, title, message, link }) => {
  const admins = await User.find({ tenantId, role: 'HR_Admin' }).select('_id');
  admins.forEach(a => notify({ tenantId, recipientId: a._id, recipientModel: 'User', type, title, message, link }));
};
