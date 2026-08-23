const multer = require("multer");
const { storage } = require("../cloudConfig");

const upload = multer({
    storage,
    limits: {
        fileSize: 5 * 1024 * 1024, // 5 MB max per image, avoids storage abuse
    },
    fileFilter: (req, file, cb) => {
        const allowed = ["image/jpeg", "image/png", "image/jpg"];
        if (allowed.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error("Only JPG and PNG images are allowed"));
        }
    },
});

module.exports = upload;