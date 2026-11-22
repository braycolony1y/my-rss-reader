function containsVietnameseSignals(text) {
  return (
    /[ăâđêôơưàảãạáằẳẵặắầẩẫậấèẻẽẹéềểễệếìỉĩịíòỏõọóồổỗộốờởỡợớùủũụúừửữựứỳỷỹỵý]/i.test(
      text
    ) ||
    /\b(của|và|trong|cho|với|tại|theo|người|công|những|được|trên|này|khi)\b/i.test(
      text
    )
  );
}

function detectArticleLanguage(article) {
  const explicit = String(
    article?.language ||
    article?.lang ||
    ''
  ).toLowerCase();

  if (explicit.startsWith('vi')) {
    return 'vi';
  }

  if (explicit.startsWith('en')) {
    return 'en';
  }

  const text = [
    article?.title,
    article?.content,
    article?.summary,
    article?.description
  ]
    .filter(Boolean)
    .join(' ');

  if (containsVietnameseSignals(text)) {
    return 'vi';
  }

  if (/[a-z]{3,}/i.test(text)) {
    return 'en';
  }

  return 'unknown';
}

function isVietnameseArticle(article) {
  return (
    article?.language === 'vi' ||
    detectArticleLanguage(article) === 'vi'
  );
}

function isEnglishArticle(article) {
  return (
    article?.language === 'en' ||
    detectArticleLanguage(article) === 'en'
  );
}

export { detectArticleLanguage, isVietnameseArticle, isEnglishArticle };
