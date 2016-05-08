var gulp   = require('gulp'),
    jshint = require('gulp-jshint'),
    stylish = require('jshint-stylish'),
    mocha = require('gulp-mocha'),
    browserify = require('browserify'),
    Server = require('karma').Server,
    uglify = require('gulp-uglify'),
    rimraf = require('rimraf'),
    source = require('vinyl-source-stream'),
    rename = require('gulp-rename'),
    streamify = require('gulp-streamify');

var jshintConfig = {node: true, browser: true, mocha: true,
  globals: {Promise: true, chai: true}};

gulp.task('lint', function() {
  return gulp.src(['./*.js', './test/*.js'])
    .pipe(jshint(jshintConfig))
    .pipe(jshint.reporter(stylish))
    .pipe(jshint.reporter('fail'));
});

gulp.task('test-node', ['lint'], function () {
  return gulp.src('test/*.spec.js', {read: false})
    .pipe(mocha({timeout: 5000}));
});

gulp.task('clean', ['test-node'], function (cb) {
  rimraf('./dist', cb);
});

gulp.task('build-browser', ['clean'], function() {
  return browserify('./index.js')
    .bundle()
    .pipe(source('pouch-mirror.js'))
    .pipe(gulp.dest('./dist/'))
    .pipe(rename('pouch-mirror.min.js'))
    .pipe(streamify(uglify()))
    .pipe(gulp.dest('./dist/'));
});

gulp.task('test-browser', ['build-browser'], function (done) {
  new Server({
    configFile: __dirname + '/karma.conf.js',
    singleRun: true
  }, done).start();
});

gulp.task('default', ['test-browser', 'build-browser', 'clean', 'test-node', 'lint']);