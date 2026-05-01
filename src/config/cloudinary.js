const fs = require('fs');
const path = require('path');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

const hasCloudinaryConfig = Boolean(
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET
);

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const localUploadDir = path.join(process.cwd(), 'uploads', 'support-tickets');

const storage = hasCloudinaryConfig
  ? new CloudinaryStorage({
      cloudinary,
      params: {
        folder: 'battlenix/support-tickets',
        allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
        transformation: [
          { width: 1920, height: 1080, crop: 'limit', quality: 80 },
        ],
        public_id: (req) => {
          const suffix = Math.random().toString(36).slice(2, 8);
          return `ticket_${req.user._id}_${Date.now()}_${suffix}`;
        },
      },
    })
  : multer.diskStorage({
      destination: (req, file, cb) => {
        fs.mkdirSync(localUploadDir, { recursive: true });
        cb(null, localUploadDir);
      },
      filename: (req, file, cb) => {
        const extension = path.extname(file.originalname || '').toLowerCase() || '.jpg';
        const suffix = Math.random().toString(36).slice(2, 8);
        cb(null, `ticket_${req.user._id}_${Date.now()}_${suffix}${extension}`);
      },
    });

const allowedMimeTypes = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);

const uploadScreenshot = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 3,
  },
  fileFilter: (req, file, cb) => {
    if (allowedMimeTypes.has(file.mimetype)) {
      cb(null, true);
      return;
    }

    cb(new Error('Only JPG, PNG, or WebP images are allowed'), false);
  },
});

module.exports = {
  cloudinary,
  uploadScreenshot,
  hasCloudinaryConfig,
};
