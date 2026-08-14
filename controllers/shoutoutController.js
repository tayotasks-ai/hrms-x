import Shoutout from '../models/Shoutout.js';
import Employee from '../models/Employee.js';

// GET /api/shoutouts  – most recent first
export const getShoutouts = async (req, res) => {
  try {
    const shoutouts = await Shoutout.find({ tenantId: req.tenantId })
      .sort({ createdAt: -1 })
      .limit(20)
      .populate('toEmployeeIds', 'name role');

    res.json({ success: true, data: shoutouts });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/shoutouts
export const createShoutout = async (req, res) => {
  try {
    const tid = req.tenantId;
    const { toEmployeeIds, message, tag } = req.body;

    if (!Array.isArray(toEmployeeIds) || toEmployeeIds.length === 0)
      return res.status(400).json({ success: false, message: 'At least one recipient is required.' });
    if (!message || !message.trim())
      return res.status(400).json({ success: false, message: 'Message is required.' });
    if (message.trim().length > 240)
      return res.status(400).json({ success: false, message: 'Message must be 240 characters or fewer.' });

    const recipients = await Employee.find({ _id: { $in: toEmployeeIds }, tenantId: tid }).select('_id');
    if (recipients.length !== toEmployeeIds.length)
      return res.status(400).json({ success: false, message: 'One or more recipients were not found.' });

    const shoutout = await Shoutout.create({
      tenantId: tid,
      from: {
        id: req.user._id,
        kind: req.userRole === 'Employee' ? 'Employee' : 'User',
        name: req.user.name
      },
      toEmployeeIds,
      message: message.trim(),
      tag: tag || null
    });

    const populated = await Shoutout.findById(shoutout._id).populate('toEmployeeIds', 'name role');
    res.status(201).json({ success: true, message: 'Shoutout posted.', data: populated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/shoutouts/:id/react  – toggle a reaction from the current user
export const reactToShoutout = async (req, res) => {
  try {
    const { emoji } = req.body;
    const validEmoji = ['👍', '🎉', '❤️'];
    if (!validEmoji.includes(emoji))
      return res.status(400).json({ success: false, message: `Emoji must be one of: ${validEmoji.join(' ')}` });

    const shoutout = await Shoutout.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!shoutout) return res.status(404).json({ success: false, message: 'Shoutout not found.' });

    const reactorId = req.user._id.toString();
    const existingIdx = shoutout.reactions.findIndex(r => r.reactorId.toString() === reactorId);

    if (existingIdx !== -1 && shoutout.reactions[existingIdx].emoji === emoji) {
      // Same emoji tapped again — remove it (toggle off)
      shoutout.reactions.splice(existingIdx, 1);
    } else if (existingIdx !== -1) {
      // Switch to a different emoji
      shoutout.reactions[existingIdx].emoji = emoji;
    } else {
      shoutout.reactions.push({ reactorId: req.user._id, emoji });
    }

    await shoutout.save();
    const populated = await Shoutout.findById(shoutout._id).populate('toEmployeeIds', 'name role');
    res.json({ success: true, data: populated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
