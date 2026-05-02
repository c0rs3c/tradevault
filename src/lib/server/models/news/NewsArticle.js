import mongoose from 'mongoose';

const NewsArticleSchema = new mongoose.Schema(
  {
    articleKey: { type: String, required: true, unique: true },
    guid: { type: String, default: '', trim: true },
    googleNewsUrl: { type: String, default: '', trim: true },
    publisherUrl: { type: String, default: '', trim: true },
    title: { type: String, required: true, trim: true },
    normalizedTitle: { type: String, default: '', trim: true },
    sourceName: { type: String, default: '', trim: true },
    sourceDomain: { type: String, default: '', trim: true },
    publishedAt: { type: Date, required: true },
    descriptionHtml: { type: String, default: '' },
    descriptionText: { type: String, default: '' },
    fetchedAt: { type: Date, required: true },
    queryWindowDays: { type: Number, default: 7 }
  },
  { timestamps: true }
);

export const getNewsArticleModel = (connection) =>
  connection.models.NewsArticle || connection.model('NewsArticle', NewsArticleSchema);
