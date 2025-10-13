const { RekognitionClient, DetectFacesCommand, CompareFacesCommand } = require("@aws-sdk/client-rekognition");
// Environment variables are provided by the platform

// Configure AWS with modern SDK v3
const rekognition = new RekognitionClient({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
  maxAttempts: 2,
  requestHandler: {
    requestTimeout: 10000,
    connectionTimeout: 5000,
  },
});

// Optimized face comparison function
const compareFaces = async (sourceImage, targetImage) => {
  try {
    const params = {
      SourceImage: {
        Bytes: sourceImage,
      },
      TargetImage: {
        Bytes: targetImage,
      },
      SimilarityThreshold: 85.0, // Reduced threshold for faster processing
      QualityFilter: "NONE", // Skip quality filter for speed
    };

    const command = new CompareFacesCommand(params);
    const result = await rekognition.send(command);

    if (result.FaceMatches && result.FaceMatches.length > 0) {
      const similarity = result.FaceMatches[0].Similarity;
      return {
        success: true,
        similarity: similarity,
        isMatch: similarity >= 85.0, // Updated threshold
        message: `Face similarity: ${similarity.toFixed(2)}%`,
      };
    } else {
      return {
        success: false,
        similarity: 0,
        isMatch: false,
        message: "No face matches found",
      };
    }
  } catch (error) {
    console.error("AWS Rekognition Error:", error);
    return {
      success: false,
      similarity: 0,
      isMatch: false,
      message: "Face comparison failed",
      error: error.message,
    };
  }
};

// Optimized face detection function
const detectFaces = async (imageBytes) => {
  try {
    const params = {
      Image: {
        Bytes: imageBytes,
      },
      Attributes: ["DEFAULT"], // Reduced attributes for faster processing
    };

    const command = new DetectFacesCommand(params);
    const result = await rekognition.send(command);

    if (result.FaceDetails && result.FaceDetails.length > 0) {
      return {
        success: true,
        faceCount: result.FaceDetails.length,
        message: `Detected ${result.FaceDetails.length} face(s)`,
      };
    } else {
      return {
        success: false,
        faceCount: 0,
        message: "No faces detected in image",
      };
    }
  } catch (error) {
    console.error("AWS Face Detection Error:", error);
    return {
      success: false,
      faceCount: 0,
      message: "Face detection failed",
      error: error.message,
    };
  }
};

module.exports = {
  rekognition,
  compareFaces,
  detectFaces,
};
