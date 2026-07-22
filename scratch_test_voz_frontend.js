const currentPostsCount = 20;
const freshPostsCount = 2;
const currentPage = 11;
const freshPage = 12;

let newPosts = [];
if (freshPage > currentPage) {
    // all posts are new!
    console.log("All posts are new");
} else if (freshPage === currentPage && freshPostsCount > currentPostsCount) {
    // some posts are new
    console.log(`Some posts are new: ${freshPostsCount - currentPostsCount}`);
}
